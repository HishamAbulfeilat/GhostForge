function shouldExecuteViaApi(command) {
  return /^(?:ghostforge|git|gh)\s+/i.test(String(command || '').trim())
}

module.exports = { shouldExecuteViaApi }
