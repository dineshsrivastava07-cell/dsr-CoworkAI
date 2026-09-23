export type TableauBusinessDomain =
  | 'retail'
  | 'zone'
  | 'regional_manager'
  | 'store_manager'
  | 'store_operations'
  | 'planning_scm'
  | 'warehouse_logistics'
  | 'finance'
  | 'digital_omni'
  | 'marketing'
  | 'visual_merchandising'
  | 'crm'
  | 'hr'
  | 'buying_merchandising'
  | 'sourcing'
  | 'loss_prevention';

export interface TableauDomainContext {
  id: TableauBusinessDomain;
  label: string;
  focus: string;
  questions: readonly [string, string, string];
}

export const TABLEAU_DOMAIN_CONTEXTS: readonly TableauDomainContext[] = [
  {
    id: 'retail',
    label: 'Retail team',
    focus: 'sales, bills, footfall, conversion, average bill value, margin and store exceptions',
    questions: [
      'Which state, zone, region and store exceptions need Retail team action now?',
      'Compare sales, bills, footfall and margin across the selected dashboards and explain only supported drivers.',
      'What seasonal or festive trading pattern is visible, and what should Retail validate next?',
    ],
  },
  {
    id: 'zone',
    label: 'Zone team',
    focus:
      'zone performance, regional variance, store contribution, availability and execution gaps',
    questions: [
      'Rank zone and region exceptions by materiality and show the source dashboard for each.',
      'Which stores are driving the zone variance, and which measures are not comparable?',
      'What zone-level festive and weather readiness actions are supported by the selected data?',
    ],
  },
  {
    id: 'regional_manager',
    label: 'Regional Manager (RM)',
    focus: 'regional scorecards, store outliers, people and execution follow-up',
    questions: [
      'Create an RM exception list by store with evidence, urgency and the next validation step.',
      'Which stores improved or declined versus the available comparison period?',
      'Where should the RM investigate availability, conversion or execution before taking action?',
    ],
  },
  {
    id: 'store_manager',
    label: 'Store Manager',
    focus: 'daily store trading, conversion, stock availability, staffing and local execution',
    questions: [
      'Summarise today or the latest available store performance and the top three exceptions.',
      'Which departments or categories need Store Manager attention based on the visible evidence?',
      'Prepare a store action checklist for the next trading period, separating facts from recommendations.',
    ],
  },
  {
    id: 'store_operations',
    label: 'Store operations',
    focus: 'operating consistency, replenishment, service, audit and store process adherence',
    questions: [
      'Which store operations exceptions repeat across the selected dashboards?',
      'Where do sales, availability and execution indicators disagree?',
      'Identify operational risks for peak or festive days and the evidence needed before intervention.',
    ],
  },
  {
    id: 'planning_scm',
    label: 'Planning & SCM',
    focus: 'forecast, plan, OTB, cover, allocation, replenishment and stock balancing',
    questions: [
      'Where do plan, forecast, sales and stock cover indicate allocation or replenishment risk?',
      'Compare demand and inventory signals by state, zone, region and store at compatible grains.',
      'What pre-festival, festival and post-festival stock actions should Planning validate?',
    ],
  },
  {
    id: 'warehouse_logistics',
    label: 'Warehouse & Logistics',
    focus: 'warehouse availability, dispatch, ageing, lead time, fill rate and store service',
    questions: [
      'Which warehouse-to-store lanes show service, ageing or availability exceptions?',
      'Where could delayed dispatch or low fill rate affect upcoming demand, if those fields are present?',
      'Prioritise logistics investigations for festive or weather-sensitive periods without assuming causality.',
    ],
  },
  {
    id: 'finance',
    label: 'Finance',
    focus: 'revenue, margin, discount, inventory value, working capital and reconciliation',
    questions: [
      'Reconcile the available revenue, margin, discount and inventory-value signals across dashboards.',
      'Which financial exceptions are material, and what denominator or definition must be confirmed?',
      'Show festive or seasonal performance in ₹ and percentage terms where the source supports both.',
    ],
  },
  {
    id: 'digital_omni',
    label: 'Digital business (Omni)',
    focus: 'digital demand, store fulfilment, availability, cancellations and channel contribution',
    questions: [
      'Compare omni and store performance only where channel definitions and periods align.',
      'Which stores or catchments show digital demand, availability or fulfilment exceptions?',
      'What omni actions are supported for the next seasonal or festive demand window?',
    ],
  },
  {
    id: 'marketing',
    label: 'Marketing',
    focus: 'campaign response, traffic, conversion, catchment, festival and community relevance',
    questions: [
      'Which campaigns, catchments or communities show meaningful response differences?',
      'Compare pre-campaign, campaign and post-campaign performance using exact available dates.',
      'What state, zone or store marketing actions are supported, and what attribution limits remain?',
    ],
  },
  {
    id: 'visual_merchandising',
    label: 'Visual Merchandising (VM)',
    focus: 'display execution, category visibility, store compliance and commercial response',
    questions: [
      'Where do VM execution and commercial outcomes move together, without claiming causality?',
      'Which stores or categories need VM review before the next peak trading window?',
      'Create a VM exception list with source, metric, filter and suggested validation evidence.',
    ],
  },
  {
    id: 'crm',
    label: 'Customer Relationship Management',
    focus: 'customer segments, repeat behaviour, frequency, value, retention and local relevance',
    questions: [
      'Which customer, community or catchment segments show changes in frequency or value?',
      'Compare repeat and new-customer behaviour only where the source defines those populations.',
      'What CRM opportunity is visible for the next festival or seasonal window, with privacy-safe evidence?',
    ],
  },
  {
    id: 'hr',
    label: 'HR',
    focus: 'staffing, attendance, productivity, training and peak-period workforce readiness',
    questions: [
      'Where do staffing or attendance measures indicate peak-period readiness risk?',
      'Compare store productivity only where hours, headcount and trading periods are aligned.',
      'What workforce follow-up is supported by the data without inferring individual performance?',
    ],
  },
  {
    id: 'buying_merchandising',
    label: 'Buying & Merchandising',
    focus: 'category, option, article, sell-through, margin, markdown, ageing and assortment',
    questions: [
      'Which categories, options or articles combine weak sell-through with ageing or markdown risk?',
      'Where do state, zone, region or catchment differences suggest an assortment review?',
      'What seasonal or festive buy adjustments should be investigated before a commitment is made?',
    ],
  },
  {
    id: 'sourcing',
    label: 'Sourcing',
    focus: 'vendor performance, lead time, quality, cost, availability and concentration risk',
    questions: [
      'Which vendor, lead-time, cost or availability exceptions need sourcing investigation?',
      'Where is supply concentration exposed to seasonal, festive or weather-sensitive demand?',
      'List sourcing recommendations with evidence and the commercial checks required before action.',
    ],
  },
  {
    id: 'loss_prevention',
    label: 'Loss Prevention',
    focus: 'shrinkage, adjustment, returns, voids, discount and inventory-control exceptions',
    questions: [
      'Which store, category or transaction-control exceptions warrant Loss Prevention review?',
      'Find unusual shrinkage, returns, void or discount patterns without labelling them as misconduct.',
      'Prioritise investigation candidates with data coverage, comparison basis and false-positive risks.',
    ],
  },
];

export function getTableauDomainContext(domain: TableauBusinessDomain): TableauDomainContext {
  return TABLEAU_DOMAIN_CONTEXTS.find((item) => item.id === domain) || TABLEAU_DOMAIN_CONTEXTS[0];
}

export const TABLEAU_CROSS_DOMAIN_QUESTIONS = [
  'Compare pre-festival, festival and post-festival performance using exact dates available in the data.',
  'Show state, zone, region, store and catchment exceptions across the selected dashboards.',
  'Assess weather sensitivity only if weather observations and matching dates or locations are present.',
] as const;
