import { createServer } from 'node:http'
import { WebSocketServer } from 'ws'

const host = '127.0.0.1'
const port = Number(process.env.DSH_SPEECH_MOCK_PORT ?? 3190)
const expectedKey = 'mock-api-key-123'

function json(res, status, body) {
  res.writeHead(status, { 'content-type': 'application/json', 'cache-control': 'no-store' })
  res.end(JSON.stringify(body))
}

function authorized(req) {
  return req.headers.authorization === `Bearer ${expectedKey}`
}

const catalog = {
  providers: {
    assemblyai: {
      defaults: { stt: { model: 'universal-streaming' } },
      stt: [{
        id: 'universal-streaming',
        canonical: 'assemblyai/universal-streaming',
        streaming: true,
        streamingInput: { audioFormats: ['pcm_16000'], portableOptions: ['interim_results'] },
        languages: ['en'],
        pricing: { unit: 'minute', unitPrice: 0.01 },
      }],
    },
    soniox: {
      defaults: { stt: { model: 'stt-rt-v5' } },
      stt: [{
        id: 'stt-rt-v5',
        canonical: 'soniox/stt-rt-v5',
        streaming: true,
        streamingInput: { audioFormats: ['pcm_16000'], portableOptions: ['interim_results', 'context'] },
        languages: ['en', 'zh'],
        pricing: { unit: 'minute', unitPrice: 0.02 },
      }],
    },
  },
}

const server = createServer(async (req, res) => {
  const url = new URL(req.url ?? '/', `http://${host}:${port}`)
  if (req.method === 'GET' && url.pathname === '/health') return json(res, 200, { ok: true })
  if (req.method === 'GET' && url.pathname === '/v1/providers') return json(res, 200, catalog)
  if (req.method === 'GET' && url.pathname === '/account/balance') {
    return authorized(req)
      ? json(res, 200, { state: 'active', paid_balance_usd: '8.25', promotion_grants: [{ remaining_usd: '1.00', eligible: true }] })
      : json(res, 401, { message: 'Unauthorized' })
  }
  if (req.method === 'POST' && url.pathname === '/account/agent-signup') return json(res, 200, { ok: true })
  if (req.method === 'POST' && url.pathname === '/account/agent-signup/verify') return json(res, 200, { apiKey: expectedKey })
  if (req.method === 'POST' && url.pathname === '/account/top-up-link') {
    return authorized(req)
      ? json(res, 200, { url: 'https://checkout.example.test/dsh-speech', expires_at: '2099-01-01T00:00:00.000Z' })
      : json(res, 401, { message: 'Unauthorized' })
  }
  json(res, 404, { message: 'Not found' })
})

const sockets = new WebSocketServer({ noServer: true })
server.on('upgrade', (req, socket, head) => {
  const url = new URL(req.url ?? '/', `http://${host}:${port}`)
  if (url.pathname !== '/v1/stt' || !authorized(req)) {
    socket.write('HTTP/1.1 401 Unauthorized\r\nConnection: close\r\n\r\n')
    socket.destroy()
    return
  }
  // Keep the preparing state observable before the upstream handshake succeeds.
  setTimeout(() => {
    if (!socket.destroyed) sockets.handleUpgrade(req, socket, head, ws => { sockets.emit('connection', ws, req) })
  }, 300)
})

sockets.on('connection', ws => {
  let binaryFrames = 0
  let committed = false
  ws.on('message', (data, isBinary) => {
    if (isBinary) {
      binaryFrames += 1
      if (binaryFrames === 1) ws.send(JSON.stringify({ type: 'stt.transcript.partial', sequence: 1, text: 'hello', language_code: 'en' }))
      if (binaryFrames === 2) ws.send(JSON.stringify({ type: 'stt.transcript.partial', sequence: 2, text: 'hello world', language_code: 'en' }))
      return
    }
    const message = JSON.parse(data.toString('utf8'))
    if (message.type === 'stt.audio.commit' && !committed) {
      committed = true
      ws.send(JSON.stringify({ type: 'stt.transcript.final', sequence: 3, text: 'hello world', language_code: 'en' }))
    }
    if (message.type === 'stt.session.close') {
      if (committed) ws.send(JSON.stringify({ type: 'stt.session.ended' }))
      setTimeout(() => { ws.close(1000, 'test complete') }, 40)
    }
  })
})

server.listen(port, host, () => {
  process.stdout.write(`mock AllModels: http://${host}:${port}\n`)
})

function shutdown() {
  for (const socket of sockets.clients) socket.close(1001, 'test shutdown')
  sockets.close()
  server.close(() => { process.exit(0) })
  setTimeout(() => { process.exit(0) }, 1_000).unref()
}

process.once('SIGTERM', shutdown)
process.once('SIGINT', shutdown)
