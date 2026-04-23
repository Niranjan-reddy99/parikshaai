from __future__ import annotations

import re
from typing import Any


_GENERIC_LABELS = {"", "general", "unclassified", "miscellaneous", "basics", "mixed"}

_TOPIC_RULES: list[tuple[re.Pattern[str], str]] = [
    (re.compile(r"\bnewton'?s laws?|laws? of motion|momentum|angular momentum|force\b", re.IGNORECASE), "Mechanics"),
    (re.compile(r"\binertia|friction|work\s+energy|power|projectile|velocity|acceleration|displacement|mass\b", re.IGNORECASE), "Mechanics"),
    (re.compile(r"\btelescope|microscope|lens|lenses|mirror|mirrors|convergent|divergent|convex|concave|optics|light\b", re.IGNORECASE), "Optics"),
    (re.compile(r"\bcarrom|coin pile|coin\b", re.IGNORECASE), "Mechanics"),
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
    (re.compile(r"\bsyllogism\b", re.IGNORECASE), "Syllogism"),
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
    (re.compile(r"\bnewton'?s laws?|laws? of motion|momentum|angular momentum|inertia|friction|force|acceleration|velocity|displacement|mass|projectile|work|energy|power|carrom|telescope|microscope|lens|lenses|mirror|mirrors|convergent|divergent|convex|concave|optics|light\b", re.IGNORECASE), "General Science"),
    (re.compile(r"\bindus|harapp|vedic|maurya|gupta|mughal|buddh|jain|gandhi|gandhian|telangana movement|social reform|temples? and architecture|historical places|history of telangana|telangana history|festivals? of telangana|art and culture\b", re.IGNORECASE), "History"),
    (re.compile(r"\btribal communities|tribal welfare|tribes of india|caste system|social stratification|social issues|vulnerable sections|transgender community issues\b", re.IGNORECASE), "Social Issues"),
    (re.compile(r"\beconomy of telangana|telangana economy|indian economy|economics?\b|\bindustr(y|ies)|industrial|msme|trade|gdp|inflation|budget|fiscal|monetary|policy resolution\b", re.IGNORECASE), "Economy"),
    (re.compile(r"\bclimate|rainfall|river|tributary|soil|geography|agro-climatic|range|locations?\b", re.IGNORECASE), "Geography"),
    (re.compile(r"\bbiodiversity|ecosystem|pollution|wildlife|environment|industrial disasters?\b", re.IGNORECASE), "Environment"),
    (re.compile(r"\bconstitution|fundamental rights|directive principles|judiciary|parliament|preamble\b", re.IGNORECASE), "Polity"),
    (re.compile(r"\bgovernment schemes?|state policies?|public policy|welfare schemes?\b", re.IGNORECASE), "Polity"),
    (re.compile(r"\bnato|united nations|un\b|world bank|imf|wto|international organizations?|foreign policy|bilateral relations|multilateral\b", re.IGNORECASE), "International Relations"),
    (re.compile(r"\bsports awards?|awards and honors?|books and authors?|languages of india|transport systems?|defence forces|military ranks|research institutions\b", re.IGNORECASE), "General Awareness"),
    (re.compile(r"\bresearch methodology|research limitations?|research implications?|research abstract|research title|research recommendations?\b", re.IGNORECASE), "General Awareness"),
    (re.compile(r"\bemerging technologies|scientists? and their contributions|space technology|biotechnology|information technology\b", re.IGNORECASE), "Science & Technology"),
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
    if _INDUSTRY_PATTERN.search(clean_subtopic) and not _INDUS_HISTORY_PATTERN.search(clean_subtopic):
        return "Economy"
    combined = f"{clean_subject} {clean_topic} {clean_subtopic}"
    for pattern, label in _SUBJECT_RULES:
        if pattern.search(combined):
            return label
    if clean_subject in {"Telangana Specific", "Telangana History", "Telangana Culture"}:
        return "History"
    if clean_subject in {"General Knowledge", "General", "Unclassified"}:
        return "General Awareness"
    return clean_subject or "General Awareness"


def canonical_topic_family(subject: Any, topic: Any, subtopic: Any) -> str:
    clean_topic = normalize_loose_label(clean_bucket_label(topic, "General"))
    clean_subtopic = normalize_loose_label(clean_bucket_label(subtopic, clean_topic))
    clean_subject = normalize_loose_label(clean_bucket_label(subject, "General Awareness"))
    combined = f"{clean_subject} {clean_topic} {clean_subtopic}"

    if _INDUSTRY_PATTERN.search(clean_subtopic) and not _INDUS_HISTORY_PATTERN.search(clean_subtopic):
        return "Industries & Industrial Policy"

    if re.search(r"\bnewton'?s laws?|laws? of motion|momentum|angular momentum|inertia|friction|force|acceleration|velocity|displacement|mass|projectile|work|energy|power|carrom|coin pile|coin\b", combined, re.IGNORECASE):
        return "Mechanics"
    if re.search(r"\btelescope|microscope|lens|lenses|mirror|mirrors|convergent|divergent|convex|concave|optics|light\b", combined, re.IGNORECASE):
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
