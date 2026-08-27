export const styles = {
  settings: 'dsh-speech-settings',
  header: 'dsh-speech-header',
  cardTitle: 'dsh-speech-card-title',
  accountWelcome: 'dsh-speech-account-welcome',
  accountIntro: 'dsh-speech-account-intro',
  freeCredit: 'dsh-speech-free-credit',
  accountHint: 'dsh-speech-account-hint',
  apiKeyDetails: 'dsh-speech-api-key-details',
  apiKeySummary: 'dsh-speech-api-key-summary',
  apiKeyBody: 'dsh-speech-api-key-body',
  topUp: 'dsh-speech-top-up',
  card: 'dsh-speech-card',
  columns: 'dsh-speech-columns',
  grid: 'dsh-speech-grid',
  modelFull: 'dsh-speech-model-full',
  contextDetails: 'dsh-speech-context-details',
  contextSummary: 'dsh-speech-context-summary',
  contextBody: 'dsh-speech-context-body',
  balanceGrid: 'dsh-speech-balance-grid',
  balanceValue: 'dsh-speech-balance-value',
  stack: 'dsh-speech-stack',
  field: 'dsh-speech-field',
  label: 'dsh-speech-label',
  hint: 'dsh-speech-hint',
  muted: 'dsh-speech-muted',
  input: 'dsh-speech-input',
  textarea: 'dsh-speech-textarea',
  primary: 'dsh-speech-primary',
  secondary: 'dsh-speech-secondary',
  checkout: 'dsh-speech-checkout',
  good: 'dsh-speech-good',
  warning: 'dsh-speech-warning',
  danger: 'dsh-speech-danger',
  micWrap: 'dsh-speech-mic-wrap',
  mic: 'dsh-speech-mic',
  micActive: 'dsh-speech-mic-active',
  micTooltip: 'dsh-speech-mic-tooltip',
  recordingTakeover: 'dsh-speech-recording-takeover',
  recordingTrack: 'dsh-speech-recording-track',
  recordingCanvas: 'dsh-speech-recording-canvas',
  recordingCancel: 'dsh-speech-recording-cancel',
  recordingStop: 'dsh-speech-recording-stop',
  recordingProgress: 'dsh-speech-recording-progress',
  deviceDock: 'dsh-speech-device-dock',
  deviceMarker: 'dsh-speech-device-marker',
  deviceFallback: 'dsh-speech-device-fallback',
  deviceSeparator: 'dsh-speech-device-separator',
  deviceIcon: 'dsh-speech-device-icon',
  deviceTrigger: 'dsh-speech-device-trigger',
  deviceLabel: 'dsh-speech-device-label',
  deviceChevron: 'dsh-speech-device-chevron',
  deviceMenu: 'dsh-speech-device-menu',
  deviceMenuItem: 'dsh-speech-device-menu-item',
  deviceCheck: 'dsh-speech-device-check',
  srOnly: 'dsh-speech-sr-only',
  dock: 'dsh-speech-dock',
  dockError: 'dsh-speech-dock-error',
  dockDetail: 'dsh-speech-dock-detail',
} as const

export const STYLE_TEXT = String.raw`
.dsh-speech-settings{display:grid;gap:16px;max-width:760px;padding:4px 2px 24px;color:var(--color-text,#e8e8e8)}
.dsh-speech-header,.dsh-speech-card-title,.dsh-speech-top-up{display:flex;align-items:center;justify-content:space-between;gap:12px}
.dsh-speech-header h2,.dsh-speech-card h3{margin:0}.dsh-speech-header p{margin:5px 0 0;color:var(--color-text-secondary,#a0a0a0);line-height:1.45}
.dsh-speech-card{display:grid;gap:14px;padding:16px;border:1px solid var(--color-border,#343434);border-radius:12px;background:var(--color-background-secondary,rgba(255,255,255,.025))}
.dsh-speech-account-welcome{padding:20px}.dsh-speech-account-intro{display:grid;gap:6px}.dsh-speech-account-intro p{margin:0;color:var(--color-text-secondary,#a0a0a0);line-height:1.45}.dsh-speech-free-credit{white-space:nowrap;border:1px solid color-mix(in srgb,#65c88a 45%,transparent);border-radius:999px;padding:4px 9px;background:color-mix(in srgb,#65c88a 12%,transparent);color:#65c88a;font-size:12px;font-weight:650}.dsh-speech-account-hint{margin:0;color:var(--color-text-secondary,#999);font-size:12px;line-height:1.45}.dsh-speech-api-key-details{border-top:1px solid var(--color-border,#343434);padding-top:12px}.dsh-speech-api-key-summary{width:max-content;color:var(--color-text-secondary,#aaa);cursor:pointer;font-size:12px;list-style-position:outside}.dsh-speech-api-key-summary:hover{color:var(--color-text,#eee)}.dsh-speech-api-key-body{display:grid;gap:10px;max-width:440px;padding-top:12px}
.dsh-speech-columns,.dsh-speech-grid,.dsh-speech-balance-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:14px}.dsh-speech-balance-grid{grid-template-columns:repeat(3,minmax(0,1fr))}
.dsh-speech-balance-grid span{display:grid;gap:5px;color:var(--color-text-secondary,#aaa)}.dsh-speech-balance-grid strong{color:var(--color-text,#eee);font-size:17px}
.dsh-speech-model-full{grid-column:1/-1}.dsh-speech-context-details{border-top:1px solid var(--color-border,#343434);padding-top:12px}.dsh-speech-context-summary{width:max-content;color:var(--color-text-secondary,#aaa);cursor:pointer;font-size:13px;font-weight:600}.dsh-speech-context-summary:hover{color:var(--color-text,#eee)}.dsh-speech-context-summary span{margin-left:5px;color:var(--color-text-secondary,#888);font-size:11px;font-weight:400}.dsh-speech-context-body{display:grid;gap:8px;padding-top:12px}.dsh-speech-balance-value{font-size:24px;line-height:1.2;color:var(--color-text,#eee)}
.dsh-speech-stack,.dsh-speech-field{display:grid;gap:7px;align-content:start}.dsh-speech-label{color:var(--color-text-secondary,#b2b2b2);font-size:13px;font-weight:600}.dsh-speech-hint,.dsh-speech-muted{margin:0;color:var(--color-text-secondary,#999);font-size:12px;line-height:1.45}
.dsh-speech-input,.dsh-speech-textarea{width:100%;box-sizing:border-box;border:1px solid var(--color-border,#444);border-radius:8px;padding:9px 10px;background:var(--color-background,#191919);color:inherit;font:inherit}.dsh-speech-textarea{min-height:84px;resize:vertical}.dsh-speech-input:focus,.dsh-speech-textarea:focus{outline:2px solid color-mix(in srgb,#68a8ff 65%,transparent);outline-offset:1px}.dsh-speech-input:disabled,.dsh-speech-textarea:disabled{opacity:.55}
.dsh-speech-primary,.dsh-speech-secondary,.dsh-speech-checkout{border:1px solid transparent;border-radius:8px;padding:8px 12px;font:inherit;font-size:13px;font-weight:600;cursor:pointer;text-decoration:none;text-align:center}.dsh-speech-primary{background:#e8e8e8;color:#151515}.dsh-speech-secondary,.dsh-speech-checkout{border-color:var(--color-border,#4a4a4a);background:transparent;color:inherit}.dsh-speech-primary:disabled,.dsh-speech-secondary:disabled{cursor:default;opacity:.45}.dsh-speech-good{color:#65c88a}.dsh-speech-warning{margin:0;color:#efb85c}.dsh-speech-danger,.dsh-speech-dock-error{margin:0;color:#f07878}
.dsh-speech-top-up{justify-content:flex-start;align-items:end;flex-wrap:wrap}.dsh-speech-top-up .dsh-speech-field{max-width:180px}
.dsh-speech-mic-wrap{position:relative;display:inline-flex;align-items:center;gap:5px;order:1}[data-slot="conversation.input.right"]:has(>.dsh-speech-mic-wrap)~button:last-child{order:2}.dsh-speech-mic{width:30px;height:30px;display:inline-grid;place-items:center;padding:0;border:0;border-radius:7px;background:transparent;color:var(--color-text-secondary,#a8a8a8);cursor:pointer}.dsh-speech-mic:hover:not(:disabled),.dsh-speech-mic:focus-visible{background:var(--color-background-hover,rgba(255,255,255,.08));color:var(--color-text,#eee)}.dsh-speech-mic[aria-disabled="true"]{opacity:.48}.dsh-speech-mic:disabled{cursor:default}.dsh-speech-mic svg{width:18px;height:18px;fill:currentColor}.dsh-speech-mic-active{color:#ef6666;background:rgba(239,102,102,.12)}.dsh-speech-mic-tooltip{position:absolute;right:0;bottom:calc(100% + 8px);z-index:40;width:max-content;max-width:260px;padding:6px 9px;border:1px solid var(--color-border,#343434);border-radius:7px;background:var(--color-background-elevated,#202020);color:var(--color-text,#eee);font-size:12px;line-height:1.35;box-shadow:0 6px 18px rgba(0,0,0,.24);opacity:0;visibility:hidden;transform:translateY(2px);pointer-events:none;transition:opacity .12s ease,transform .12s ease,visibility .12s}.dsh-speech-mic-wrap:hover .dsh-speech-mic-tooltip,.dsh-speech-mic-wrap:focus-within .dsh-speech-mic-tooltip,.dsh-speech-mic-wrap[data-explanation-open="true"] .dsh-speech-mic-tooltip{opacity:1;visibility:visible;transform:translateY(0)}
:where(div):has(>:where(div)>[data-slot="conversation.input.right"]>.dsh-speech-recording-takeover){position:relative}:where(div):has(>:where(div)>[data-slot="conversation.input.right"]>.dsh-speech-recording-takeover)>*{visibility:hidden}.dsh-speech-recording-takeover{position:absolute;inset:0;z-index:8;visibility:visible;display:flex;align-items:center;gap:10px;padding:4px 8px;box-sizing:border-box;color:var(--color-text-secondary,#a8a8a8)}.dsh-speech-recording-track{height:30px;min-width:0;flex:1;display:flex;align-items:center}.dsh-speech-recording-canvas{display:block;width:100%;height:30px;color:var(--color-text-secondary,#a8a8a8)}.dsh-speech-recording-cancel,.dsh-speech-recording-stop{flex:none;border-radius:999px}.dsh-speech-recording-cancel{color:var(--color-text-secondary,#a8a8a8);background:transparent}.dsh-speech-recording-cancel:hover:not(:disabled),.dsh-speech-recording-cancel:focus-visible{background:var(--color-background-hover,rgba(255,255,255,.08));color:var(--color-text,#eee)}.dsh-speech-recording-stop{color:#ef6666;background:rgba(239,102,102,.12)}.dsh-speech-recording-stop:hover:not(:disabled),.dsh-speech-recording-stop:focus-visible{color:#ff7777;background:rgba(239,102,102,.2)}.dsh-speech-recording-progress{display:flex;align-items:center;justify-content:flex-end;gap:8px;width:100%;color:var(--color-text-secondary,#a8a8a8);font-size:12px}.dsh-speech-recording-takeover[data-phase="starting"] .dsh-speech-recording-progress{justify-content:center}.dsh-speech-recording-progress i{width:13px;height:13px;border:2px solid currentColor;border-right-color:transparent;border-radius:50%;animation:dsh-speech-spin .8s linear infinite}.dsh-speech-sr-only{position:absolute;width:1px;height:1px;padding:0;margin:-1px;overflow:hidden;clip:rect(0,0,0,0);white-space:nowrap;border:0}@keyframes dsh-speech-spin{to{transform:rotate(360deg)}}
.dsh-speech-device-marker{display:none}[data-slot="conversation.composer.dock"]>:has(>.dsh-speech-device-dock){overflow:visible}.dsh-speech-device-fallback{min-height:22px;display:flex;align-items:center;justify-content:flex-start;padding:0 8px;overflow:visible}.dsh-speech-device-fallback .dsh-speech-device-dock{margin-left:0}.dsh-speech-device-separator{margin-left:4px;color:var(--dsw-alias-label-tertiary,var(--color-text-secondary,#888))}.dsh-speech-device-dock{position:relative;display:inline-flex;vertical-align:middle;margin-left:5px;color:var(--dsw-alias-label-secondary,var(--color-text-secondary,#a8a8a8));font:inherit}.dsh-speech-device-trigger{max-width:126px;height:20px;display:inline-flex;align-items:center;gap:4px;padding:0 5px;border:0;border-radius:6px;background:transparent;color:inherit;font:inherit;font-size:11px;line-height:20px;cursor:pointer}.dsh-speech-device-trigger:hover,.dsh-speech-device-trigger:focus-visible,.dsh-speech-device-trigger[aria-expanded="true"]{outline:0;background:var(--dsw-alias-interactive-bg-hover,rgba(255,255,255,.08));color:var(--dsw-alias-label-primary,var(--color-text,#eee))}.dsh-speech-device-trigger:disabled{cursor:wait;opacity:.6}.dsh-speech-device-dock[data-error="true"] .dsh-speech-device-trigger{color:var(--dsw-alias-state-error-primary,#f07878)}.dsh-speech-device-icon,.dsh-speech-device-chevron{display:inline-flex;flex:none}.dsh-speech-device-icon svg{width:12px;height:12px}.dsh-speech-device-chevron svg{width:10px;height:10px}.dsh-speech-device-label{min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.dsh-speech-device-menu{position:absolute;right:0;bottom:calc(100% + 6px);z-index:80;min-width:240px;max-width:min(320px,calc(100vw - 32px));display:grid;box-sizing:border-box;padding:4px;border:1px solid var(--dsw-alias-border-l2-darkmode-thin,rgba(255,255,255,.06));border-radius:12px;background:var(--dsw-alias-bg-layer-3,#353638);color:var(--dsw-alias-label-primary,#f9fafb);box-shadow:0 0 1px rgba(0,0,0,.2),0 0 4px rgba(0,0,0,.02),0 12px 32px rgba(0,0,0,.08);font:13px/20px -apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif}.dsh-speech-device-menu-item{width:100%;min-width:0;height:38px;display:flex;align-items:center;justify-content:space-between;gap:12px;padding:0 10px;border:0;border-radius:10px;background:transparent;color:inherit;font:inherit;text-align:left;cursor:pointer}.dsh-speech-device-menu-item:hover,.dsh-speech-device-menu-item:focus-visible{outline:0;background:var(--dsw-alias-interactive-bg-hover,rgba(255,255,255,.08))}.dsh-speech-device-menu-item>span:first-child{min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.dsh-speech-device-check{width:14px;height:14px;display:inline-flex;flex:none;color:var(--dsw-alias-brand-primary,var(--dsw-alias-label-primary,#f9fafb))}.dsh-speech-device-check svg{width:14px;height:14px}.dsh-speech-device-dock[data-variant="hero"]{margin-left:0;color:var(--dsw-alias-label-primary,var(--color-text,#f9fafb));font:500 13px/20px -apple-system,BlinkMacSystemFont,"Segoe UI","PingFang SC","Hiragino Sans GB","Microsoft YaHei","Helvetica Neue",Helvetica,Arial,sans-serif}.dsh-speech-device-dock[data-variant="hero"] .dsh-speech-device-trigger{max-width:220px;height:28px;padding:0 8px;gap:4px;border-radius:16px;font:inherit;line-height:20px}.dsh-speech-device-dock[data-variant="hero"] .dsh-speech-device-icon svg{width:16px;height:16px}.dsh-speech-device-dock[data-variant="hero"] .dsh-speech-device-chevron svg{width:14px;height:14px}.dsh-speech-device-dock[data-variant="hero"] .dsh-speech-device-menu{left:0;right:auto;top:calc(100% + 6px);bottom:auto;min-width:218px}
[data-dsh-speech-nav]>svg{display:none}[data-dsh-speech-nav]::before{content:"";width:16px;height:16px;flex:none;background:currentColor;mask:url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 20 20'%3E%3Crect x='7' y='2' width='6' height='11' rx='3' fill='none' stroke='black' stroke-width='1.7'/%3E%3Cpath d='M4.5 9.5a5.5 5.5 0 0 0 11 0M10 15v3M7 18h6' fill='none' stroke='black' stroke-width='1.7' stroke-linecap='round'/%3E%3C/svg%3E") center/contain no-repeat}
.dsh-speech-dock,.dsh-speech-dock-error{min-height:22px;display:flex;align-items:center;gap:9px;padding:4px 8px 0;font-size:12px}.dsh-speech-dock-detail{color:var(--color-text-secondary,#8d8d8d)}
@media(max-width:680px){.dsh-speech-columns,.dsh-speech-grid,.dsh-speech-balance-grid{grid-template-columns:1fr}.dsh-speech-header{align-items:flex-start}.dsh-speech-device-separator,.dsh-speech-device-dock{display:none}}
@media(prefers-reduced-motion:reduce){.dsh-speech-mic-tooltip{transition:none}.dsh-speech-recording-progress i{animation:none;border-right-color:currentColor}}
`
