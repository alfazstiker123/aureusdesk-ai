// Model gateway yang terlihat di dropdown gateway user. guess:true = id ditebak dari nama tampilan
// (pastikan lewat "Tes Koneksi Gateway"; id yang salah otomatis jatuh ke cadangan Gemini).
export const GATEWAY_MODELS = [
  { id: 'deepseek-v4-pro', label: 'DeepSeek V4 Pro — ×1.15 ★ saran harian' },
  { id: 'glm-5.2', label: 'GLM-5.2 — ×1.25 (cadangan)', guess: true },
  { id: 'mimo-v2.5-pro', label: 'MiMo V2.5 Pro — ×1.4 (cadangan)' },
  { id: 'kimi-k2.7-code-highspeed', label: 'Kimi K2.7 Code Highspeed — ×1.5', guess: true },
  { id: 'kimi-k3', label: 'Kimi K3' },
  { id: 'gpt-5.6-luna', label: 'GPT-5.6 Luna' },
  { id: 'glm-5.3-flash', label: 'GLM-5.3 Flash — ×2', guess: true },
  { id: 'deepseek-v4-flash', label: 'DeepSeek V4 Flash — ×2' },
  { id: 'deepseek-v4.1-flash', label: 'DeepSeek V4.1 Flash', guess: true },
  { id: 'mimo-v2.6-flash', label: 'MiMo V2.6 Flash — ×2' },
];
export const GATEWAY_PRESETS = GATEWAY_MODELS.map((m) => m.id);
