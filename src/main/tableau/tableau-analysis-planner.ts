import type {
  TableauDimensionCoverage,
  TableauDimensionLevel,
  TableauViewData,
  TableauViewFilter,
  TableauViewInfo,
} from '../../shared/tableau-types';

export const GOVERNED_VMART_DIMENSIONS: ReadonlyArray<{
  level: TableauDimensionLevel;
  label: string;
  aliases: readonly string[];
}> = [
  { level: 'state', label: 'State', aliases: ['State', 'State Name', 'State_Name'] },
  { level: 'zone', label: 'Zone', aliases: ['Zone', 'Zone Name', 'Zone_Name'] },
  { level: 'region', label: 'Region', aliases: ['Region', 'Region Name', 'Region_Name'] },
  {
    level: 'store',
    label: 'Store',
    aliases: ['Store', 'Store Name', 'Store_Name', 'Store Code', 'Store ID'],
  },
];

const STOP_WORDS = new Set([
  'a',
  'about',
  'and',
  'are',
  'by',
  'for',
  'from',
  'how',
  'in',
  'is',
  'of',
  'on',
  'performance',
  'show',
  'the',
  'to',
  'what',
  'which',
  'with',
]);

const INTENT_TERMS: ReadonlyArray<{ terms: readonly string[]; viewTerms: readonly string[] }> = [
  { terms: ['festival', 'festive', 'diwali', 'holi', 'eid'], viewTerms: ['festive', 'festival'] },
  { terms: ['business'], viewTerms: ['business performance', 'business review'] },
  {
    terms: ['sale', 'sales', 'revenue', 'growth'],
    viewTerms: ['sales', 'performance', 'business'],
  },
  { terms: ['state'], viewTerms: ['state', 'geography', 'business', 'retail'] },
  { terms: ['zone', 'zonal'], viewTerms: ['zone', 'zonal', 'business', 'retail'] },
  { terms: ['region', 'regional'], viewTerms: ['region', 'regional', 'business', 'retail'] },
  { terms: ['store', 'shop'], viewTerms: ['store', 'retail', 'business'] },
  {
    terms: ['product', 'article', 'sku', 'category', 'department'],
    viewTerms: ['product', 'article', 'sku', 'category', 'department', 'dept'],
  },
  { terms: ['stock', 'inventory', 'availability'], viewTerms: ['stock', 'inventory', 'oos'] },
  {
    terms: ['plan', 'budget', 'forecast', 'target'],
    viewTerms: ['plan', 'budget', 'forecast', 'target'],
  },
  { terms: ['margin', 'profit'], viewTerms: ['margin', 'profit', 'business'] },
];

function normalize(value: string): string {
  return value
    .normalize('NFKC')
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .replace(/\b(?:attr|sum|avg|average|min|max|count|countd|agg)\s*\(([^)]+)\)/gi, '$1')
    .replace(/[()[\]{}_\-/]+/g, ' ')
    .replace(/[^a-zA-Z0-9&% ]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .toLocaleLowerCase();
}

function viewHaystack(view: TableauViewInfo): string {
  return normalize(
    [view.name, view.workbookName, view.projectName, view.contentUrl].filter(Boolean).join(' ')
  );
}

function questionTokens(question: string): string[] {
  return [
    ...new Set(
      normalize(question)
        .split(' ')
        .filter((term) => term.length > 2 && !STOP_WORDS.has(term))
    ),
  ];
}

export function requestedTableauDimensions(question: string): TableauDimensionLevel[] {
  const normalized = ` ${normalize(question)} `;
  return GOVERNED_VMART_DIMENSIONS.filter(({ level }) =>
    new RegExp(`\\b${level}(?:s|wise)?\\b`, 'i').test(normalized)
  ).map(({ level }) => level);
}

export function scoreTableauViewForQuestion(question: string, view: TableauViewInfo): number {
  const normalizedQuestion = normalize(question);
  const haystack = viewHaystack(view);
  let score = 0;
  for (const token of questionTokens(question)) {
    if (haystack.includes(token)) score += token.length >= 6 ? 35 : 20;
  }
  for (const intent of INTENT_TERMS) {
    if (!intent.terms.some((term) => normalizedQuestion.includes(term))) continue;
    score += intent.viewTerms.reduce(
      (total, term) => total + (haystack.includes(normalize(term)) ? 55 : 0),
      0
    );
  }
  for (const level of requestedTableauDimensions(question)) {
    if (new RegExp(`\\b${level}\\b`).test(haystack)) score += 150;
  }
  if (/festive performance/.test(haystack)) score += 18;
  if (/business performance/.test(haystack)) score += 16;
  return score;
}

export function buildTableauCandidatePool(
  question: string,
  views: readonly TableauViewInfo[],
  roleMatches: readonly TableauViewInfo[],
  limit = 8
): TableauViewInfo[] {
  const roleRank = new Map(roleMatches.map((view, index) => [view.id, roleMatches.length - index]));
  return [...views]
    .map((view) => ({
      view,
      score: scoreTableauViewForQuestion(question, view) + (roleRank.get(view.id) || 0),
    }))
    .filter((candidate) => candidate.score > 0)
    .sort(
      (left, right) =>
        right.score - left.score ||
        (roleRank.get(right.view.id) || 0) - (roleRank.get(left.view.id) || 0) ||
        left.view.name.localeCompare(right.view.name)
    )
    .slice(0, Math.max(3, limit))
    .map((candidate) => candidate.view);
}

function dimensionForField(field: string): TableauDimensionLevel | null {
  const normalized = normalize(field);
  for (const dimension of GOVERNED_VMART_DIMENSIONS) {
    if (dimension.aliases.some((alias) => normalize(alias) === normalized)) return dimension.level;
    if (new RegExp(`\\b${dimension.level}\\b`).test(normalized)) return dimension.level;
  }
  return null;
}

export function detectTableauDimensionCoverage(
  datasets: readonly TableauViewData[]
): TableauDimensionCoverage[] {
  return GOVERNED_VMART_DIMENSIONS.map((dimension) => {
    const fields = datasets.flatMap((data) =>
      data.columns
        .filter((column) => dimensionForField(column) === dimension.level)
        .map((field) => ({
          viewId: data.view.id,
          viewName: data.view.name,
          field,
          sampleValues: [
            ...new Set(data.rows.map((row) => row[field]?.trim()).filter(Boolean)),
          ].slice(0, 8),
          source: 'export' as const,
        }))
    );
    if (fields.length) {
      return {
        level: dimension.level,
        label: dimension.label,
        available: true,
        availability: 'observed' as const,
        fields,
      };
    }
    return {
      level: dimension.level,
      label: dimension.label,
      available: true,
      availability: 'configured' as const,
      fields: [
        {
          field: dimension.aliases[0],
          sampleValues: [],
          source: 'governed-filter' as const,
        },
      ],
    };
  });
}

export function selectTableauDatasetsForQuestion(
  question: string,
  candidateData: readonly TableauViewData[],
  maximum = 3
): { datasets: TableauViewData[]; reasons: Record<string, string[]> } {
  const requested = new Set(requestedTableauDimensions(question));
  const selected: TableauViewData[] = [];
  const covered = new Set<TableauDimensionLevel>();
  const reasons: Record<string, string[]> = {};
  const remaining = [...candidateData];
  while (selected.length < maximum && remaining.length) {
    const scored = remaining.map((data) => {
      const observed = new Set(
        data.columns
          .map((column) => dimensionForField(column))
          .filter((value): value is TableauDimensionLevel => value !== null)
      );
      const newRequestedCoverage = [...observed].filter(
        (level) => requested.has(level) && !covered.has(level)
      );
      const relevance = scoreTableauViewForQuestion(question, data.view);
      const score =
        relevance +
        newRequestedCoverage.length * 500 +
        (data.columns.length ? 40 : 0) +
        (data.rows.length ? 20 : 0);
      return { data, observed, newRequestedCoverage, relevance, score };
    });
    scored.sort(
      (left, right) =>
        right.score - left.score || left.data.view.name.localeCompare(right.data.view.name)
    );
    const winner = scored[0];
    if (!winner || (!winner.data.columns.length && selected.length > 0)) break;
    selected.push(winner.data);
    winner.observed.forEach((level) => covered.add(level));
    reasons[winner.data.view.id] = [
      winner.relevance
        ? 'Matched the analytical question and dashboard metadata.'
        : 'Matched the role catalogue.',
      ...(winner.newRequestedCoverage.length
        ? [`Adds requested ${winner.newRequestedCoverage.join(', ')} dimension coverage.`]
        : []),
      winner.data.columns.length
        ? `Export exposed ${winner.data.columns.length} fields and ${winner.data.rows.length} loaded rows.`
        : 'Selected as a fallback; no export fields were returned.',
    ];
    remaining.splice(
      remaining.findIndex((data) => data.view.id === winner.data.view.id),
      1
    );
  }
  return { datasets: selected, reasons };
}

function includesPhrase(question: string, value: string): boolean {
  const normalizedQuestion = ` ${normalize(question)} `;
  const normalizedValue = normalize(value);
  return normalizedValue.length >= 2 && normalizedQuestion.includes(` ${normalizedValue} `);
}

export function deriveTableauQuestionFilters(
  question: string,
  data: TableauViewData
): TableauViewFilter[] {
  const filters: TableauViewFilter[] = [];
  for (const field of data.columns) {
    const dimension = dimensionForField(field);
    const values = [...new Set(data.rows.map((row) => row[field]?.trim()).filter(Boolean))].filter(
      (value) => includesPhrase(question, value)
    );
    if ((dimension || values.length) && values.length)
      filters.push({ field, values: values.slice(0, 10) });
  }
  return filters.slice(0, 8);
}
