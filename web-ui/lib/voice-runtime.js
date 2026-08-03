const DEFAULT_WAKE_PHRASES = ['hey ghostforge', 'hey jarvis', 'ok jarvis', 'okay jarvis']

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
  const texts = Array.from(results || [])
    .map(result => result?.[0]?.transcript || '')
    .map(text => text.replace(/\s+/g, ' ').trim())
    .filter(Boolean)
  if (!texts.length) return ''
  const last = texts[texts.length - 1]
  const prior = texts.slice(0, -1).join(' ')
  // Web Speech API results are cumulative — every result repeats all speech
  // heard so far, so joining them duplicates text. When the last result
  // already contains the prior speech, it is the full transcript: use it
  // alone. Otherwise the results are discrete segments — join them.
  if (prior && last.includes(prior)) return last
  return texts.join(' ')
}

module.exports = {
  DEFAULT_WAKE_PHRASES,
  collectRecognitionTranscript,
  findWakePhrase,
  normalizeSpeech,
}
