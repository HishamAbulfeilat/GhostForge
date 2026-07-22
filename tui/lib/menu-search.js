const ANSI_PATTERN = /[\u001B\u009B][[\]()#;?]*(?:(?:(?:[a-zA-Z\d]*(?:;[-a-zA-Z\d\/#&.:=?%@~_]+)*)?\u0007)|(?:(?:\d{1,4}(?:[;:]\d{0,4})*)?[\dA-PR-TZcf-nq-uy=><~]))/g;

export function normalizeSearchText(value = '') {
  return String(value)
    .replace(ANSI_PATTERN, '')
    .toLocaleLowerCase()
    .replace(/[^\p{L}\p{N}/.+#-]+/gu, ' ')
    .trim();
}

export function fuzzyScore(query, candidate) {
  const needle = normalizeSearchText(query);
  const haystack = normalizeSearchText(candidate);
  if (!needle) return 0;
  if (!haystack) return Number.NEGATIVE_INFINITY;

  const directIndex = haystack.indexOf(needle);
  if (directIndex >= 0) {
    const wordBonus = directIndex === 0 || haystack[directIndex - 1] === ' ' ? 30 : 0;
    return 1000 + wordBonus - directIndex - (haystack.length - needle.length) * 0.01;
  }

  let score = 0;
  let queryIndex = 0;
  let firstMatch = -1;
  let previousMatch = -2;
  for (let candidateIndex = 0; candidateIndex < haystack.length && queryIndex < needle.length; candidateIndex += 1) {
    if (haystack[candidateIndex] !== needle[queryIndex]) continue;
    score += candidateIndex === previousMatch + 1 ? 8 : 2;
    if (candidateIndex === 0 || haystack[candidateIndex - 1] === ' ') score += 5;
    if (firstMatch === -1) firstMatch = candidateIndex;
    previousMatch = candidateIndex;
    queryIndex += 1;
  }

  if (queryIndex !== needle.length) return Number.NEGATIVE_INFINITY;
  if (previousMatch - firstMatch + 1 > needle.length * 2.5) return Number.NEGATIVE_INFINITY;
  return score - (haystack.length - needle.length) * 0.02;
}

export function filterMenuChoices(choices, term) {
  if (!term?.trim()) return choices;

  return choices
    .filter(choice => !choice.disabled)
    .map((choice, index) => ({
      choice,
      index,
      score: fuzzyScore(term, choice.searchText || `${choice.name || ''} ${choice.value || ''}`),
    }))
    .filter(result => Number.isFinite(result.score))
    .sort((left, right) => right.score - left.score || left.index - right.index)
    .map(result => result.choice);
}

export function groupCommandChoices(commands, expandedCategories = new Set(), term = '') {
  const categories = [...new Set(commands.map(command => command.cat))];
  const searching = Boolean(term?.trim());

  return categories.flatMap(category => {
    const categoryCommands = commands.filter(command => command.cat === category);
    const categoryScore = fuzzyScore(term, category);
    const matches = searching
      ? categoryCommands
          .map((command, index) => ({
            command,
            index,
            score: Math.max(
              categoryScore,
              fuzzyScore(term, `${command.name} ${command.desc} ${command.cat}`),
            ),
          }))
          .filter(result => Number.isFinite(result.score))
          .sort((left, right) => right.score - left.score || left.index - right.index)
          .map(result => result.command)
      : categoryCommands;

    if (searching && matches.length === 0) return [];

    const expanded = searching || expandedCategories.has(category);
    return [
      { type: 'category', category, count: categoryCommands.length, expanded },
      ...(expanded ? matches.map(command => ({ type: 'command', command })) : []),
    ];
  });
}
