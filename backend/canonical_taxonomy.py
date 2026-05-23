from __future__ import annotations

import re
from typing import Any


_GENERIC_LABELS = {"", "general", "unclassified", "miscellaneous", "basics", "mixed"}

# Topic names that unambiguously belong to a specific subject regardless of what subject the AI assigned.
# These override the raw subject field when a clear mismatch is detected.
_ALWAYS_LOGICAL_REASONING = frozenset({
    "seating arrangement", "blood relations", "puzzles & ranking", "series",
    "direction sense", "analogies", "coding-decoding", "statement & conclusion",
    "venn diagrams", "syllogisms", "syllogism", "synergisms", "input-output",
})
_ALWAYS_QUANTITATIVE = frozenset({
    "ratio and proportion", "data interpretation", "number system", "algebra & equations",
    "averages & mixtures", "percentages", "geometry & mensuration",
    "time, speed and distance", "statistics & probability", "profit and loss",
    "interest", "arithmetic", "time and work",
})
_ALWAYS_ENGLISH = frozenset({
    "para jumbles", "grammar & usage", "fill in the blanks", "vocabulary",
    "reading comprehension", "idioms & phrases", "one-word substitution",
    "sentence correction",
})
_ALWAYS_HISTORY = frozenset({
    "ancient history", "medieval history", "modern history", "indian national movement",
    "indus valley civilization", "mughal empire", "mauryan empire", "gupta empire",
    "vedic period", "buddhism", "jainism", "world history", "post-independence india",
    "social reform movements", "gandhian thought & movements",
})
_ALWAYS_SCIENCE = frozenset({
    "biology", "chemistry", "physics", "biotechnology", "space technology",
    "computer fundamentals", "information technology", "defence technology",
    "medical science", "inventions & discoveries", "nuclear technology",
    "programming basics", "operating systems",
    # "mechanics" and "optics" excluded — ambiguous in QA/aptitude context
})
_ALWAYS_POLITY = frozenset({
    "constitutional development", "fundamental rights", "parliament", "judiciary",
    "preamble", "elections & political parties", "local government", "president & executive",
    "emergency provisions", "criminal laws", "evidence act", "legal terminology",
    "legal definitions", "legal reforms", "electoral offences",
})
# These topics are always Current Affairs regardless of which subject the AI assigned
_ALWAYS_CURRENT_AFFAIRS = frozenset({
    "domestic affairs", "summits & conferences",
})

# Technical subject topic anchors — topics that unambiguously belong to a specific engineering/professional subject
_ALWAYS_ELECTRICAL = frozenset({
    "circuit theory & network analysis", "electrical machines", "power systems",
    "power electronics", "measurements & instrumentation",
    "electromagnetic theory", "high voltage engineering", "electrical materials & wiring",
})
_ALWAYS_MECHANICAL = frozenset({
    "thermodynamics & heat transfer", "strength of materials",
    "theory of machines & machine design", "manufacturing technology",
    "industrial engineering & management", "refrigeration & air conditioning",
    "engineering mechanics", "metrology & quality control",
})
_ALWAYS_CIVIL = frozenset({
    "structural engineering", "geotechnical engineering",
    "transportation engineering", "irrigation & water resources",
    "concrete technology", "estimating & costing", "surveying & mapping",
    "construction materials & technology",
})
_ALWAYS_ECE = frozenset({
    "electronic devices & circuits", "digital electronics & logic design",
    "communication systems", "signals & systems",
    "microprocessors & microcontrollers", "vlsi design", "antenna & wave propagation",
})
_ALWAYS_CSE = frozenset({
    "data structures & algorithms", "database management systems",
    "computer networks", "software engineering", "theory of computation",
    "computer architecture & organization", "compiler design",
    "artificial intelligence & machine learning",
})
_ALWAYS_AGRICULTURE = frozenset({
    "soil science & agronomy", "horticulture & floriculture",
    "plant pathology & entomology", "agricultural economics & marketing",
    "seed technology & genetics", "animal husbandry & veterinary science",
    "farm machinery & engineering", "agricultural extension", "post-harvest technology",
})
_ALWAYS_FORESTRY = frozenset({
    "forest management & policy", "silviculture", "forest botany & ecology",
    "wildlife management & conservation", "agroforestry & social forestry",
    "wood science & technology", "forest survey & mapping", "forest laws & administration",
})
_ALWAYS_COMMERCE = frozenset({
    "financial accounting", "cost & management accounting",
    "business law & company law", "auditing & assurance",
    "taxation (direct & indirect)", "capital markets & securities",
})
_ALWAYS_LAW = frozenset({
    "criminal law & procedure", "civil law & procedure",
    "contract & tort law", "property & transfer law",
    "family law & personal law", "administrative law",
    "international law", "labour & industrial law", "evidence law",
})
_ALWAYS_PUBLIC_ADMIN = frozenset({
    "administrative theory & thought", "organisational behaviour",
    "public policy & analysis", "budgeting & financial administration",
    "e-governance & digital services", "rural & urban administration",
    "development administration", "comparative public administration",
    "accountability & ethics",
})

# Known OCR/AI garbled topic names → correct canonical name
_TOPIC_NAME_FIXES: dict[str, str] = {
    "synergisms": "Syllogisms",
    "awards & records": "Awards & Honours",
}

_TOPIC_RULES: list[tuple[re.Pattern[str], str]] = [
    (re.compile(r"\bnewton'?s laws?|laws? of motion|momentum|angular momentum|net force|applied force|balanced forces?|unbalanced forces?\b", re.IGNORECASE), "Mechanics"),
    (re.compile(r"\binertia|friction|work done|work[- ]energy|kinetic energy|potential energy|conservation of energy|projectile|velocity|acceleration|displacement\b", re.IGNORECASE), "Mechanics"),
    (re.compile(r"\btelescope|microscope|lens|lenses|mirror|mirrors|convergent|divergent|convex|concave|optics|reflection of light|refraction of light|ray optics|light rays?\b", re.IGNORECASE), "Optics"),
    (re.compile(r"\bcarrom(?: striker)?|coin pile|carrom coin\b", re.IGNORECASE), "Mechanics"),
    (re.compile(r"\bresearch methodology|research limitations?|research implications?|research abstract|research title|research recommendations?\b", re.IGNORECASE), "Research Methodology"),
    (re.compile(r"\bair pollution|water pollution|noise pollution|thermal pollution|plastic pollution|chemical pollution|mercury pollution|atmospheric pollution|ocean pollution|pollution control|pollution control boards?|pollution control acts?|pollution control devices?|pollution control initiatives|pollution control technologies|environmental pollution|pollutants?\b", re.IGNORECASE), "Pollution"),
    (re.compile(r"\bbuddh(a|is|ism|ist|hist)\b", re.IGNORECASE), "Buddhism"),
    (re.compile(r"\bjain(a|ism|ist)?\b", re.IGNORECASE), "Jainism"),
    (re.compile(r"\bgandhi|gandhian|mahatma gandhi|non-cooperation|civil disobedience|quit india\b", re.IGNORECASE), "Gandhian Thought & Movements"),
    (re.compile(r"\btelangana movement|formation of telangana|statehood movement\b", re.IGNORECASE), "Telangana Movement"),
    (re.compile(r"\btelangana history|social history of telangana|history of telangana|ancient and medieval history of telangana\b", re.IGNORECASE), "Telangana History"),
    (re.compile(r"\btelangana culture|arts and crafts|literary institutions|tribal culture|cultural aspects\b", re.IGNORECASE), "Telangana Culture"),
    (re.compile(r"\bmaurya|ashoka|chandragupta maurya\b", re.IGNORECASE), "Mauryan Empire"),
    (re.compile(r"\bmughal|akbar|jahangir|shah jahan|aurangzeb\b", re.IGNORECASE), "Mughal Empire"),
    (re.compile(r"\bgupta\b", re.IGNORECASE), "Gupta Empire"),
    (re.compile(r"\bvedic|rig ved|sam ved|yajur ved|atharva ved\b", re.IGNORECASE), "Vedic Period"),
    (re.compile(r"\bindus|harapp(a|an)\b", re.IGNORECASE), "Indus Valley Civilization"),
    (re.compile(r"\btribal welfare|tribal sub-?plan|tribal development schemes?|tribal welfare schemes?\b", re.IGNORECASE), "Tribal Welfare & Development"),
    (re.compile(r"\btribal communities|tribes of india|tribal societies in india|tribal culture|tribal practices|tribal marriage customs|scheduled tribes population|scheduled tribes and their regions|tribal communities of india\b", re.IGNORECASE), "Tribal Communities"),
    (re.compile(r"\bscheduled castes and scheduled tribes act|scheduled castes and tribes act|sc/st act\b", re.IGNORECASE), "SC/ST Protection Law"),
    (re.compile(r"\bscheduled castes and tribes|scheduled castes|scheduled tribes|national commission for scheduled castes|national commission for scheduled tribes|declaration of scheduled tribes|commissions? for scheduled tribes|scheduled tribes committees?\b", re.IGNORECASE), "Scheduled Castes & Scheduled Tribes"),
    (re.compile(r"\bcaste system|social stratification|social structure and castes|caste movements?|caste-based organizations?|madiga reservation porata samithi|socio-economic and caste census\b", re.IGNORECASE), "Caste & Social Stratification"),
    (re.compile(r"\bsocial reforms?|social reform movements?|social reformers?\b", re.IGNORECASE), "Social Reform Movements"),
    (re.compile(r"\bconstitution|constituent assembly\b", re.IGNORECASE), "Constitutional Development"),
    (re.compile(r"\bfundamental rights|article 14|article 19|article 21|article 32\b", re.IGNORECASE), "Fundamental Rights"),
    (re.compile(r"\bdirective principles|dpsp\b", re.IGNORECASE), "Directive Principles of State Policy"),
    (re.compile(r"\bfundamental duties\b", re.IGNORECASE), "Fundamental Duties"),
    (re.compile(r"\bparliament|lok sabha|rajya sabha\b", re.IGNORECASE), "Parliament"),
    (re.compile(r"\bjudiciary|supreme court|high court|judicial review\b", re.IGNORECASE), "Judiciary"),
    (re.compile(r"\bpreamble\b", re.IGNORECASE), "Preamble"),
    (re.compile(r"\bbharatiya nyaya sanhita|bharatiya nagarik suraksha sanhita|bharatiya sakshya adhiniyam|criminal laws?|criminal procedure|evidence act|legal terminology|legal definitions|legal reforms|electoral offences?\b", re.IGNORECASE), "Criminal Laws"),
    (re.compile(r"\bmonsoon|rainfall\b", re.IGNORECASE), "Monsoon & Rainfall"),
    (re.compile(r"\briver|tributary|basin\b", re.IGNORECASE), "Rivers"),
    (re.compile(r"\bsoil\b", re.IGNORECASE), "Soils"),
    (re.compile(r"\bclimate change|global warming|greenhouse\b", re.IGNORECASE), "Climate Change"),
    (re.compile(r"\bbiodiversity|iucn|red list|endangered|wildlife\b", re.IGNORECASE), "Biodiversity & Conservation"),
    (re.compile(r"\becology|ecosystem|food chain|food web\b", re.IGNORECASE), "Ecology"),
    (re.compile(r"\binflation|cpi|wpi\b", re.IGNORECASE), "Inflation"),
    (re.compile(r"\bgdp|gnp|national income\b", re.IGNORECASE), "National Income"),
    (re.compile(r"\bbudget|fiscal deficit|revenue deficit\b", re.IGNORECASE), "Budget & Fiscal Policy"),
    (re.compile(r"\bmonetary policy|repo rate|reverse repo|crr|slr\b", re.IGNORECASE), "Monetary Policy"),
    (re.compile(r"\bindustr(y|ies)|industrial corridors?|industrial policy|industrial production|industrial development|manufacturing|sez|special economic zone|msme\b", re.IGNORECASE), "Industries & Industrial Policy"),
    (re.compile(r"\btelangana budget|state budgets?\b", re.IGNORECASE), "State Budget & Economy"),
    (re.compile(r"\btelangana schemes?|government schemes?|state policies?|policy\b", re.IGNORECASE), "Government Schemes & Policies"),
    (re.compile(r"\bseating arrangement|circular arrangement|linear arrangement|square arrangement\b", re.IGNORECASE), "Seating Arrangement"),
    (re.compile(r"\bblood relation|family tree\b", re.IGNORECASE), "Blood Relations"),
    (re.compile(r"\bsyllogisms?\b|synergism\b", re.IGNORECASE), "Syllogisms"),
    (re.compile(r"\bcoding|decoding\b", re.IGNORECASE), "Coding-Decoding"),
    (re.compile(r"\bseries\b", re.IGNORECASE), "Series"),
    (re.compile(r"\bdirection sense|direction\b", re.IGNORECASE), "Direction Sense"),
    (re.compile(r"\btime,? speed|distance|relative speed|boats? and streams?\b", re.IGNORECASE), "Time, Speed and Distance"),
    (re.compile(r"\btime and work|work and wages|pipes and cisterns\b", re.IGNORECASE), "Time and Work"),
    (re.compile(r"\bprofit|loss|discount|marked price\b", re.IGNORECASE), "Profit and Loss"),
    (re.compile(r"\bsimple interest|compound interest\b", re.IGNORECASE), "Interest"),
    (re.compile(r"\bpercentage\b", re.IGNORECASE), "Percentages"),
    (re.compile(r"\bratio|proportion|partnership\b", re.IGNORECASE), "Ratio and Proportion"),
]

_SUBJECT_RULES: list[tuple[re.Pattern[str], str]] = [
    # Science & Technology rules FIRST (before Geography, to catch "Geography | Space Technology")
    (re.compile(r"\bspace technology|space missions?|isro|nasa|chandrayaan|mangalyaan|gaganyaan|pslv|gslv|rocket launch|satellite launch|space station|space exploration\b", re.IGNORECASE), "Science & Technology"),
    (re.compile(r"\bemerging technologies|scientists? and their contributions|biotechnology|information technology|computer|software|hardware|programming\b", re.IGNORECASE), "Science & Technology"),
    # Physics / optics → Science & Technology (not "General Science")
    (re.compile(r"\bnewton'?s laws?|laws? of motion|momentum|angular momentum|inertia|friction|acceleration|velocity|displacement|projectile|work done|kinetic energy|potential energy|conservation of energy|carrom|telescope|microscope|lens|lenses|mirror|mirrors|convergent|divergent|convex|concave|optics\b", re.IGNORECASE), "Science & Technology"),
    (re.compile(r"\bindus|harapp|vedic|maurya|gupta|mughal|buddh|jain|gandhi|gandhian|telangana movement|social reform|temples? and architecture|historical places|history of telangana|telangana history|festivals? of telangana|art and culture\b", re.IGNORECASE), "History"),
    (re.compile(r"\btribal communities|tribal welfare|tribes of india|caste system|social stratification|social issues|vulnerable sections|transgender community issues\b", re.IGNORECASE), "Social Issues"),
    (re.compile(r"\beconomy of telangana|telangana economy|indian economy|economics\b|\bindustr(y|ies)|industrial|msme|trade and commerce|trade policy|trade deficit|trade balance|trade war|gdp|inflation|budget|fiscal|monetary|policy resolution\b", re.IGNORECASE), "Economy"),
    (re.compile(r"\bclimate|rainfall|river|tributary|soil|geography|agro-climatic|range|locations?\b", re.IGNORECASE), "Geography"),
    (re.compile(r"\bbiodiversity|ecosystem|pollution|wildlife|environment|industrial disasters?\b", re.IGNORECASE), "Environment"),
    (re.compile(r"\bconstitution|fundamental rights|directive principles|judiciary|parliament|preamble|bharatiya nyaya sanhita|bharatiya nagarik suraksha sanhita|bharatiya sakshya adhiniyam|criminal laws?|criminal procedure|evidence act|legal terminology|legal definitions|legal reforms|electoral offences?\b", re.IGNORECASE), "Polity"),
    (re.compile(r"\bgovernment schemes?|state policies?|public policy|welfare schemes?\b", re.IGNORECASE), "Polity"),
    (re.compile(r"\bnato|united nations|un\b|world bank|imf|wto|international organizations?|foreign policy|bilateral relations|multilateral\b", re.IGNORECASE), "Current Affairs"),
    (re.compile(r"\bsports awards?|awards and honors?|books and authors?|languages of india|transport systems?|defence forces|military ranks|research institutions\b", re.IGNORECASE), "General Awareness"),
    (re.compile(r"\bresearch methodology|research limitations?|research implications?|research abstract|research title|research recommendations?\b", re.IGNORECASE), "General Awareness"),
]

_GENERIC_SUBTOPIC_BITS = (
    "introduction", "basics", "overview", "concept", "facts", "features",
    "principles", "provisions", "causes", "effects", "impact", "classification",
    "types", "examples", "applications", "important terms", "miscellaneous",
)

_INDUSTRY_PATTERN = re.compile(
    r"\bindustry\b|\bindustries\b|\bindustrial\b|industrial corridors?|industrial polic(y|ies)|industrial production|industrial development|manufacturing|sez|special economic zone|msme\b",
    re.IGNORECASE,
)
_INDUS_HISTORY_PATTERN = re.compile(
    r"\bindus valley|harappan civilization|harappan culture|indus civilization\b",
    re.IGNORECASE,
)
_POLITY_RESCUE_PATTERN = re.compile(
    r"\bgovernment of india act|reorganisation act|reorganization act|state reorganisation|state reorganization|"
    r"concurrent list|union list|state list|ordinance|fundamental rights|judgment|judgements|court|judiciary|"
    r"parliament|waqf|workmen'?s compensation act|forest rights act|manual scavengers|transgender persons|"
    r"disabilities act|government orders?|g\.o\.|go 610|committees? and commissions?|union territories|"
    r"religious laws?/acts?|social legislation|legal principles|rights of persons with disabilities|"
    r"official secrets act|right to information act|migrant workmen|personal data protection|laws and acts|"
    r"acts and laws|acts and reforms|law enforcement initiatives|national security laws|criminal laws?|"
    r"evidence act|electoral offences?|state formation|state reorganization acts?\b",
    re.IGNORECASE,
)
_CRIMINAL_LAW_PATTERN = re.compile(
    r"\bbharatiya nyaya sanhita|bharatiya nagarik suraksha sanhita|bharatiya sakshya adhiniyam|"
    r"criminal laws?|criminal procedure|evidence act|legal terminology|legal definitions|legal reforms|"
    r"electoral offences?\b",
    re.IGNORECASE,
)


def clean_bucket_label(value: Any, fallback: str) -> str:
    raw = str(value or "").strip()
    if raw.lower() in _GENERIC_LABELS:
        return fallback
    return raw or fallback


def normalize_loose_label(value: Any) -> str:
    normalized = str(value or "").strip()
    if not normalized:
        return ""
    normalized = re.sub(r"\s+", " ", normalized)
    normalized = re.sub(r"\s*\([^)]*\)\s*", " ", normalized)
    normalized = re.sub(r"\btelangana state specific\b", "Telangana Specific", normalized, flags=re.IGNORECASE)
    normalized = re.sub(r"\bstate specific\b", "State Specific", normalized, flags=re.IGNORECASE)
    normalized = re.sub(r"\btelangana culture and history\b", "Telangana History", normalized, flags=re.IGNORECASE)
    normalized = re.sub(r"\bhistory of telangana\b", "Telangana History", normalized, flags=re.IGNORECASE)
    normalized = re.sub(r"\btelangana specific\b", "Telangana Specific", normalized, flags=re.IGNORECASE)
    normalized = re.sub(r"\bcurrent affairs and events\b", "Current Affairs", normalized, flags=re.IGNORECASE)
    normalized = re.sub(r"\bscheduled castes and tribes\b", "Scheduled Castes & Scheduled Tribes", normalized, flags=re.IGNORECASE)
    normalized = re.sub(r"\bscheduled castes and scheduled tribes\b", "Scheduled Castes & Scheduled Tribes", normalized, flags=re.IGNORECASE)
    normalized = re.sub(r"\btribes of india\b", "Tribal Communities", normalized, flags=re.IGNORECASE)
    normalized = re.sub(r"\btribal societies in india\b", "Tribal Communities", normalized, flags=re.IGNORECASE)
    normalized = re.sub(r"\btribal communities\b", "Tribal Communities", normalized, flags=re.IGNORECASE)
    normalized = re.sub(r"^\s*caste movements and organizations\s*$", "Caste Movements", normalized, flags=re.IGNORECASE)
    normalized = re.sub(r"^\s*social reformers\s*$", "Social Reform Movements", normalized, flags=re.IGNORECASE)
    normalized = re.sub(r"^\s*social reforms?\s*$", "Social Reform Movements", normalized, flags=re.IGNORECASE)
    return re.sub(r"\s+", " ", normalized).strip()


def canonical_subject_family(subject: Any, topic: Any, subtopic: Any) -> str:
    clean_subject = normalize_loose_label(clean_bucket_label(subject, "General Knowledge"))
    clean_topic = normalize_loose_label(clean_bucket_label(topic, "General"))
    clean_subtopic = normalize_loose_label(clean_bucket_label(subtopic, clean_topic))

    # Topic-based subject overrides — topic name unambiguously signals the right subject
    topic_lc = clean_topic.lower()
    if topic_lc in _ALWAYS_CURRENT_AFFAIRS and clean_subject not in {"Current Affairs"}:
        return "Current Affairs"
    if topic_lc in _ALWAYS_LOGICAL_REASONING:
        return "Logical Reasoning"
    if topic_lc in _ALWAYS_QUANTITATIVE:
        return "Quantitative Aptitude"
    if topic_lc in _ALWAYS_ENGLISH:
        return "English Language"
    if topic_lc in _ALWAYS_HISTORY and clean_subject not in {"History"}:
        return "History"
    if topic_lc in _ALWAYS_SCIENCE and clean_subject not in {"Science & Technology"}:
        return "Science & Technology"
    if topic_lc in _ALWAYS_POLITY and clean_subject not in {"Polity"}:
        return "Polity"

    # Technical subject overrides — only correct mislabelling WITHIN the technical domain.
    # Rule: only fires when AI already assigned a technical subject — never reclassifies a GS subject.
    # This prevents GS questions about physics/thermodynamics/law from being pulled into engineering buckets.
    _TECHNICAL_SUBJECTS = {
        "electrical engineering", "mechanical engineering", "civil engineering",
        "electronics & communication engineering", "computer science & engineering",
        "chemical engineering", "agriculture", "forestry",
        "commerce & accountancy", "law", "public administration",
    }
    if clean_subject.lower() in _TECHNICAL_SUBJECTS:
        if topic_lc in _ALWAYS_ELECTRICAL:
            return "Electrical Engineering"
        if topic_lc in _ALWAYS_MECHANICAL:
            return "Mechanical Engineering"
        if topic_lc in _ALWAYS_CIVIL:
            return "Civil Engineering"
        if topic_lc in _ALWAYS_ECE:
            return "Electronics & Communication Engineering"
        if topic_lc in _ALWAYS_CSE:
            return "Computer Science & Engineering"
        if topic_lc in _ALWAYS_AGRICULTURE:
            return "Agriculture"
        if topic_lc in _ALWAYS_FORESTRY:
            return "Forestry"
        if topic_lc in _ALWAYS_COMMERCE:
            return "Commerce & Accountancy"
        if topic_lc in _ALWAYS_LAW:
            return "Law"
        if topic_lc in _ALWAYS_PUBLIC_ADMIN:
            return "Public Administration"

    rescue_text = f"{clean_topic} {clean_subtopic}"
    if _CRIMINAL_LAW_PATTERN.search(rescue_text) or _POLITY_RESCUE_PATTERN.search(rescue_text):
        return "Polity"

    if _INDUSTRY_PATTERN.search(clean_subtopic) and not _INDUS_HISTORY_PATTERN.search(clean_subtopic):
        return "Economy"

    # Subjects with well-defined canonical topic sets don't need regex reclassification.
    # Topic-based overrides above still fire when a topic clearly belongs elsewhere.
    _STABLE_SUBJECTS = {
        "History", "Current Affairs", "English Language", "Logical Reasoning",
        "Quantitative Aptitude", "Polity", "Science & Technology", "Environment",
    }
    if clean_subject in _STABLE_SUBJECTS:
        return clean_subject

    combined = f"{clean_subject} {clean_topic} {clean_subtopic}"
    for pattern, label in _SUBJECT_RULES:
        if pattern.search(combined):
            return label
    if clean_subject in {"Telangana Specific", "Telangana History", "Telangana Culture"}:
        return "History"
    if clean_subject in {"General Knowledge", "General", "Unclassified"}:
        return "General Awareness"
    # Geography mis-tagged as space → belongs in Science & Technology
    if clean_subject == "Geography" and re.search(r"\bspace|isro|nasa|satellite|rocket|chandrayaan|mangalyaan|gaganyaan\b", f"{clean_topic} {clean_subtopic}", re.IGNORECASE):
        return "Science & Technology"
    # Legacy subject remaps
    if clean_subject == "General Science":
        return "Science & Technology"
    if clean_subject in {"Post-Independence India", "Medieval History", "Ancient History", "Modern History", "World History"}:
        return "History"
    if clean_subject in {"Computer Knowledge", "Computer Science"}:
        return "Science & Technology"
    if clean_subject == "International Relations":
        return "Current Affairs"
    if clean_subject == "Mathematics":
        return "Quantitative Aptitude"
    if clean_subject == "Art & Culture":
        return "History"
    return clean_subject or "General Awareness"


def canonical_topic_family(subject: Any, topic: Any, subtopic: Any) -> str:
    clean_topic = normalize_loose_label(clean_bucket_label(topic, "General"))
    clean_subtopic = normalize_loose_label(clean_bucket_label(subtopic, clean_topic))
    clean_subject = normalize_loose_label(clean_bucket_label(subject, "General Awareness"))

    # Fix known OCR/AI garbled topic names before any other processing
    if clean_topic.lower() in _TOPIC_NAME_FIXES:
        return _TOPIC_NAME_FIXES[clean_topic.lower()]

    combined = f"{clean_subject} {clean_topic} {clean_subtopic}"

    if _INDUSTRY_PATTERN.search(clean_subtopic) and not _INDUS_HISTORY_PATTERN.search(clean_subtopic):
        return "Industries & Industrial Policy"

    # Space Technology always belongs under Science & Technology regardless of subject
    if re.search(r"\bspace (technology|mission|exploration|research)|isro|nasa|chandrayaan|mangalyaan|gaganyaan|pslv|gslv|satellite launch|space station\b", combined, re.IGNORECASE):
        return "Space Technology"

    rescue_text = f"{clean_topic} {clean_subtopic}"
    if clean_subject == "Polity" and (_CRIMINAL_LAW_PATTERN.search(rescue_text) or _POLITY_RESCUE_PATTERN.search(rescue_text)):
        if _CRIMINAL_LAW_PATTERN.search(rescue_text):
            return "Criminal Laws"
        if (
            clean_subtopic
            and clean_subtopic.lower() not in _GENERIC_LABELS
            and clean_subtopic.lower() != clean_topic.lower()
            and len(clean_subtopic.split()) <= 6
            and not re.search(r"[?.!:;]", clean_subtopic)
        ):
            return clean_subtopic
        return "Constitutional Development"

    if re.search(r"\bnewton'?s laws?|laws? of motion|momentum|angular momentum|net force|applied force|balanced forces?|unbalanced forces?|inertia|friction|acceleration|velocity|displacement|projectile|work done|kinetic energy|potential energy|conservation of energy|carrom(?: striker)?|coin pile|carrom coin\b", combined, re.IGNORECASE):
        return "Mechanics"
    if re.search(r"\btelescope|microscope|lens|lenses|mirror|mirrors|convergent|divergent|convex|concave|optics|reflection of light|refraction of light|ray optics|light rays?\b", combined, re.IGNORECASE):
        return "Optics"

    for pattern, label in _TOPIC_RULES:
        if pattern.search(combined):
            return label

    if clean_subject == "International Relations" and re.search(r"\bnato|united nations|world bank|imf|wto|international organizations?\b", combined, re.IGNORECASE):
        return "International Organizations"
    if clean_subject == "General Awareness" and re.search(r"\bawards?|books?|authors?|languages?|sports|defence|transport|research institutions?\b", combined, re.IGNORECASE):
        return clean_topic
    if clean_subject == "Environment" and "pollution" in combined.lower():
        return "Pollution"
    if clean_topic == "Telangana Specific":
        if clean_subject == "History":
            if re.search(r"\bculture|festival|dance|art|literary|tribal culture\b", combined, re.IGNORECASE):
                return "Telangana Culture"
            if re.search(r"\bmovement\b", combined, re.IGNORECASE):
                return "Telangana Movement"
            return "Telangana History"
        if clean_subject == "Economy":
            if re.search(r"\bscheme|policy\b", combined, re.IGNORECASE):
                return "Government Schemes & Policies"
            return "Telangana Economy"
        if clean_subject == "Geography":
            return "Telangana Geography"
        if clean_subject == "Polity":
            return "Telangana Polity"
    if clean_subject == "History" and re.search(r"\btelangana|hyderabad\b", combined, re.IGNORECASE):
        if re.search(r"\bmovement\b", combined, re.IGNORECASE):
            return "Telangana Movement"
        if re.search(r"\bculture|festival|dance|art|literary|tribal culture\b", combined, re.IGNORECASE):
            return "Telangana Culture"
        return "Telangana History"
    if clean_subject == "Economy" and re.search(r"\btelangana\b", combined, re.IGNORECASE):
        if re.search(r"\bscheme|policy\b", combined, re.IGNORECASE):
            return "Government Schemes & Policies"
        return "Telangana Economy"

    topic_lc = clean_topic.lower()
    subtopic_lc = clean_subtopic.lower()
    if subtopic_lc == topic_lc:
        return clean_topic
    if subtopic_lc.startswith(topic_lc) or topic_lc.startswith(subtopic_lc):
        return clean_topic
    if any(bit in subtopic_lc for bit in _GENERIC_SUBTOPIC_BITS):
        return clean_topic
    return clean_topic or "General"


def canonical_subtopic_family(topic_family: Any, subtopic: Any) -> str:
    clean_topic_family = normalize_loose_label(clean_bucket_label(topic_family, "General"))
    clean_subtopic = normalize_loose_label(clean_bucket_label(subtopic, clean_topic_family))
    if not clean_subtopic:
        return clean_topic_family
    combined = f"{clean_topic_family} {clean_subtopic}"
    if clean_topic_family == "Mechanics":
        if re.search(r"\bsecond law of motion|newton'?s second law\b", combined, re.IGNORECASE):
            return "Newton's Laws of Motion"
        if re.search(r"\bnewton'?s laws?|laws? of motion\b", combined, re.IGNORECASE):
            return "Newton's Laws of Motion"
        if re.search(r"\bmomentum|angular momentum\b", combined, re.IGNORECASE):
            return "Momentum"
        if re.search(r"\binertia|carrom|coin pile\b", combined, re.IGNORECASE):
            return "Inertia"
        if re.search(r"\bfriction\b", combined, re.IGNORECASE):
            return "Friction"
    if clean_topic_family == "Optics":
        if re.search(r"\btelescope|astronomical telescope\b", combined, re.IGNORECASE):
            return "Optical Instruments"
        if re.search(r"\blens|lenses|convergent|divergent|convex|concave\b", combined, re.IGNORECASE):
            return "Lenses"
    if clean_subtopic.lower() == clean_topic_family.lower():
        return clean_topic_family
    return clean_subtopic


def derive_canonical_taxonomy(subject: Any, topic: Any, subtopic: Any) -> dict[str, str]:
    raw_subject = normalize_loose_label(clean_bucket_label(subject, "General Knowledge"))
    raw_topic = normalize_loose_label(clean_bucket_label(topic, "General"))
    raw_subtopic = normalize_loose_label(clean_bucket_label(subtopic, raw_topic))
    canonical_subject = canonical_subject_family(raw_subject, raw_topic, raw_subtopic)
    canonical_topic = canonical_topic_family(canonical_subject, raw_topic, raw_subtopic)
    canonical_subtopic = canonical_subtopic_family(canonical_topic, raw_subtopic)
    return {
        "canonical_subject": canonical_subject,
        "canonical_topic_family": canonical_topic,
        "canonical_subtopic_family": canonical_subtopic,
    }


def apply_canonical_taxonomy(row: dict[str, Any]) -> dict[str, Any]:
    raw_subject = row.get("subject")
    raw_topic = row.get("topic")
    raw_subtopic = row.get("subtopic")
    canonical = derive_canonical_taxonomy(raw_subject, raw_topic, raw_subtopic)
    updated = dict(row)
    updated.setdefault("raw_subject", raw_subject)
    updated.setdefault("raw_topic", raw_topic)
    updated.setdefault("raw_subtopic", raw_subtopic)
    updated.update(canonical)
    updated["subject"] = canonical["canonical_subject"]
    updated["topic"] = canonical["canonical_topic_family"]
    updated["subtopic"] = canonical["canonical_subtopic_family"]
    return updated
