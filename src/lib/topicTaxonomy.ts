export function cleanBucketLabel(value: string | undefined, fallback: string): string {
  const raw = (value || '').trim();
  if (!raw || ['general', 'unclassified', 'miscellaneous', 'basics', 'mixed'].includes(raw.toLowerCase())) {
    return fallback;
  }
  return raw;
}

export function normalizeLooseLabel(value: string): string {
  return value
    .replace(/\s+/g, ' ')
    .replace(/\s*\([^)]*\)\s*/g, ' ')
    .replace(/\bstate specific\b/gi, 'State Specific')
    .replace(/\btelangana specific\b/gi, 'Telangana Specific')
    .trim();
}

export function canonicalSubjectFamily(subject: string, topic: string, subtopic: string): string {
  const combined = `${subject} ${topic} ${subtopic}`.toLowerCase();

  if (/\bindus|harapp|vedic|maurya|gupta|mughal|buddh|jain|gandhi|gandhian|telangana movement|social reform|temples? and architecture|festivals? of telangana|art and culture\b/.test(combined)) {
    return 'History';
  }
  if (/\bindustr(y|ies)|industrial|msme|trade|gdp|inflation|budget|fiscal|monetary|policy resolution\b/.test(combined)) {
    return 'Economy';
  }
  if (/\bclimate|rainfall|river|tributary|soil|forest|geography|agro-climatic|range|locations?\b/.test(combined)) {
    return 'Geography';
  }
  if (/\bbiodiversity|ecosystem|pollution|wildlife|environment|industrial disasters?\b/.test(combined)) {
    return 'Environment';
  }
  if (/\bconstitution|fundamental rights|directive principles|judiciary|parliament|preamble\b/.test(combined)) {
    return 'Polity';
  }

  return cleanBucketLabel(subject, 'General Knowledge');
}

export function canonicalConceptFamily(subject: string, topic: string, subtopic: string): string {
  const cleanTopic = cleanBucketLabel(topic, 'General');
  const cleanSubtopic = cleanBucketLabel(subtopic, cleanTopic);
  const combined = `${subject} ${cleanTopic} ${cleanSubtopic}`.toLowerCase();

  const rules: Array<[RegExp, string]> = [
    [/\bbuddh(a|is|ism|ist|hist)\b/, 'Buddhism'],
    [/\bjain(a|ism|ist)?\b/, 'Jainism'],
    [/\bgandhi|gandhian|mahatma gandhi|non-cooperation|civil disobedience|quit india\b/, 'Gandhian Thought & Movements'],
    [/\btelangana movement|formation of telangana|statehood movement\b/, 'Telangana Movement'],
    [/\btelangana history|social history of telangana|ancient and medieval history of telangana\b/, 'Telangana History'],
    [/\btelangana culture|arts and crafts|literary institutions|tribal culture|cultural aspects\b/, 'Telangana Culture'],
    [/\bmौर?yan|ashoka|chandragupta maurya\b/, 'Mauryan Empire'],
    [/\bmughal|akbar|jahangir|shah jahan|aurangzeb\b/, 'Mughal Empire'],
    [/\bgupta\b/, 'Gupta Empire'],
    [/\bvedic|rig ved|sam ved|yajur ved|atharva ved\b/, 'Vedic Period'],
    [/\bindus|harapp(a|an)\b/, 'Indus Valley Civilization'],
    [/\bconstitution|constituent assembly\b/, 'Constitutional Development'],
    [/\bfundamental rights|article 14|article 19|article 21|article 32\b/, 'Fundamental Rights'],
    [/\bdirective principles|dpsp\b/, 'Directive Principles of State Policy'],
    [/\bfundamental duties\b/, 'Fundamental Duties'],
    [/\bparliament|lok sabha|rajya sabha\b/, 'Parliament'],
    [/\bjudiciary|supreme court|high court|judicial review\b/, 'Judiciary'],
    [/\bpreamble\b/, 'Preamble'],
    [/\bmonsoon|rainfall\b/, 'Monsoon & Rainfall'],
    [/\briver|tributary|basin\b/, 'Rivers'],
    [/\bsoil\b/, 'Soils'],
    [/\bclimate change|global warming|greenhouse\b/, 'Climate Change'],
    [/\bbiodiversity|iucn|red list|endangered|wildlife\b/, 'Biodiversity & Conservation'],
    [/\becology|ecosystem|food chain|food web\b/, 'Ecology'],
    [/\binflation|cpi|wpi\b/, 'Inflation'],
    [/\bgdp|gnp|national income\b/, 'National Income'],
    [/\bbudget|fiscal deficit|revenue deficit\b/, 'Budget & Fiscal Policy'],
    [/\bmonetary policy|repo rate|reverse repo|crr|slr\b/, 'Monetary Policy'],
    [/\bindustr(y|ies)|industrial corridors?|industrial policy|industrial production|industrial development|manufacturing|sez|special economic zone|msme\b/, 'Industries & Industrial Policy'],
    [/\btelangana budget|state budgets?\b/, 'State Budget & Economy'],
    [/\btelangana schemes?|government schemes?|state policies?|policy\b/, 'Government Schemes & Policies'],
    [/\bseating arrangement|circular arrangement|linear arrangement|square arrangement\b/, 'Seating Arrangement'],
    [/\bblood relation|family tree\b/, 'Blood Relations'],
    [/\bsyllogism\b/, 'Syllogism'],
    [/\bcoding|decoding\b/, 'Coding-Decoding'],
    [/\bseries\b/, 'Series'],
    [/\bdirection sense|direction\b/, 'Direction Sense'],
    [/\btime,? speed|distance|relative speed|boats? and streams?\b/, 'Time, Speed and Distance'],
    [/\btime and work|work and wages|pipes and cisterns\b/, 'Time and Work'],
    [/\bprofit|loss|discount|marked price\b/, 'Profit and Loss'],
    [/\bsimple interest|compound interest\b/, 'Interest'],
    [/\bpercentage\b/, 'Percentages'],
    [/\bratio|proportion|partnership\b/, 'Ratio and Proportion'],
  ];

  for (const [pattern, label] of rules) {
    if (pattern.test(combined)) return label;
  }

  const topicLc = cleanTopic.toLowerCase();
  const subtopicLc = cleanSubtopic.toLowerCase();

  if (subtopicLc === topicLc) return cleanTopic;
  if (subtopicLc.startsWith(topicLc) || topicLc.startsWith(subtopicLc)) return cleanTopic;

  const genericSubtopicBits = [
    'introduction', 'basics', 'overview', 'concept', 'facts', 'features',
    'principles', 'provisions', 'causes', 'effects', 'impact', 'classification',
    'types', 'examples', 'applications', 'important terms', 'miscellaneous',
  ];
  if (genericSubtopicBits.some(bit => subtopicLc.includes(bit))) return cleanTopic;

  return normalizeLooseLabel(cleanTopic);
}

