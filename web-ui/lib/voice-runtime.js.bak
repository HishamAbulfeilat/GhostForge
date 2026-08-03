const DEFAULT_WAKE_PHRASES = ['hey ghostforge', 'hey jarvis', 'ok jarvis', 'okay jarvis', 'jarvis']

function normalizeSpeech(value) {
  return String(value || '')
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

function findWakePhrase(transcript, phrases = DEFAULT_WAKE_PHRASES) {
  const normalizedTranscript = normalizeSpeech(transcript)
  const sorted = [...phrases].sort((a, b) => normalizeSpeech(b).length - normalizeSpeech(a).length)
  return sorted.find(phrase => normalizedTranscript.includes(normalizeSpeech(phrase))) || null
}

function collectRecognitionTranscript(results) {
  return Array.from(results || [])
    .map(result => result?.[0]?.transcript || '')
    .join(' ')
    .replace(/\s+/g, ' ')
    .trim()
}

module.exports = {
  DEFAULT_WAKE_PHRASES,
  collectRecognitionTranscript,
  findWakePhrase,
  normalizeSpeech,
}
