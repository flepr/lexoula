// Thèmes du vocabulaire (identifiants partagés avec l'appli : src/themes.js)
export const THEMES = [
  "family", "character", "emotions", "health", "food", "home", "daily", "time",
  "work", "tech", "education", "society", "justice", "culture", "nature",
  "travel", "transport", "expressions", "connectors", "ideas",
] as const;

export const THEME_HELP = `family = family, relationships, love
character = personality traits, behaviour
emotions = feelings, moods, mental states, mental health
health = body, health, medicine, sport
food = food, drink, cooking, restaurants
home = house, furniture, chores, objects at home
daily = daily life, routines, shopping, clothes, leisure
time = time, dates, numbers, quantities, weather
work = work, jobs, economy, money, business
tech = technology, internet, media, screens
education = school, learning, languages, parenting
society = society, politics, debates, social issues
justice = law, justice, crime, rules
culture = arts, culture, history, religion, traditions
nature = nature, animals, environment, climate
travel = travel, tourism, places, countries, geography
transport = city, transport, driving, directions
expressions = idioms and fixed expressions
connectors = connectors, adverbs and phrases to argue and nuance
ideas = abstract notions and verbs of thinking/acting that fit no other theme`;

export const LANGS = ["en", "fr", "de", "es", "it", "ru", "pl", "tr"] as const;
export const LANG_NAMES: Record<string, string> = {
  en: "English", fr: "French", de: "German", es: "Spanish",
  it: "Italian", ru: "Russian", pl: "Polish", tr: "Turkish",
};
