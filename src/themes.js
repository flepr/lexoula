// Thèmes (mêmes identifiants que supabase/functions/_shared/themes.ts)
// gr = libellé grec affiché à côté ; puis en, fr, de, es, it, ru, pl, tr
import { LANGS, getLang } from "./i18n.js";

const T = {
  family: ["Οικογένεια & σχέσεις", "Family & relationships", "Famille & relations", "Familie & Beziehungen", "Familia y relaciones", "Famiglia e relazioni", "Семья и отношения", "Rodzina i relacje", "Aile ve ilişkiler"],
  character: ["Χαρακτήρας", "Character & behaviour", "Caractère & comportements", "Charakter & Verhalten", "Carácter y conducta", "Carattere e comportamento", "Характер и поведение", "Charakter i zachowanie", "Karakter ve davranış"],
  emotions: ["Συναισθήματα", "Feelings & mind", "Émotions & états d'esprit", "Gefühle & Gemüt", "Emociones y estados de ánimo", "Emozioni e stati d'animo", "Чувства и состояния", "Uczucia i nastroje", "Duygular ve ruh hâli"],
  health: ["Υγεία & σώμα", "Health, body & sport", "Santé, corps & sport", "Gesundheit, Körper & Sport", "Salud, cuerpo y deporte", "Salute, corpo e sport", "Здоровье, тело и спорт", "Zdrowie, ciało i sport", "Sağlık, beden ve spor"],
  food: ["Φαγητό", "Food & drink", "Cuisine & repas", "Essen & Trinken", "Comida y bebida", "Cibo e bevande", "Еда и напитки", "Jedzenie i picie", "Yemek ve içecek"],
  home: ["Σπίτι", "Home", "Maison", "Zuhause", "Casa", "Casa", "Дом", "Dom", "Ev"],
  daily: ["Καθημερινότητα", "Daily life", "Vie quotidienne", "Alltag", "Vida cotidiana", "Vita quotidiana", "Повседневная жизнь", "Życie codzienne", "Günlük hayat"],
  time: ["Χρόνος & αριθμοί", "Time, numbers & weather", "Temps, nombres & météo", "Zeit, Zahlen & Wetter", "Tiempo, números y clima", "Tempo, numeri e meteo", "Время, числа и погода", "Czas, liczby i pogoda", "Zaman, sayılar ve hava"],
  work: ["Δουλειά & οικονομία", "Work, economy & money", "Travail, économie & argent", "Arbeit, Wirtschaft & Geld", "Trabajo, economía y dinero", "Lavoro, economia e denaro", "Работа, экономика и деньги", "Praca, gospodarka i pieniądze", "İş, ekonomi ve para"],
  tech: ["Τεχνολογία & μέσα", "Technology & media", "Écrans, médias & technologie", "Technik & Medien", "Tecnología y medios", "Tecnologia e media", "Технологии и СМИ", "Technologia i media", "Teknoloji ve medya"],
  education: ["Μάθηση & ανατροφή", "Learning & parenting", "Éducation & parentalité", "Bildung & Erziehung", "Educación y crianza", "Istruzione e genitorialità", "Учёба и воспитание", "Nauka i wychowanie", "Eğitim ve çocuk yetiştirme"],
  society: ["Κοινωνία", "Society & debates", "Société & débats", "Gesellschaft & Debatten", "Sociedad y debates", "Società e dibattiti", "Общество и дискуссии", "Społeczeństwo i debaty", "Toplum ve tartışmalar"],
  justice: ["Δικαιοσύνη", "Law & justice", "Justice & règles", "Recht & Justiz", "Ley y justicia", "Legge e giustizia", "Закон и правосудие", "Prawo i sprawiedliwość", "Hukuk ve adalet"],
  culture: ["Πολιτισμός", "Culture, arts & history", "Culture, arts & histoire", "Kultur, Kunst & Geschichte", "Cultura, arte e historia", "Cultura, arte e storia", "Культура, искусство и история", "Kultura, sztuka i historia", "Kültür, sanat ve tarih"],
  nature: ["Φύση", "Nature & environment", "Nature & environnement", "Natur & Umwelt", "Naturaleza y medio ambiente", "Natura e ambiente", "Природа и окружающая среда", "Przyroda i środowisko", "Doğa ve çevre"],
  travel: ["Ταξίδια", "Travel & places", "Voyage & géographie", "Reisen & Orte", "Viajes y lugares", "Viaggi e luoghi", "Путешествия и места", "Podróże i miejsca", "Seyahat ve yerler"],
  transport: ["Πόλη & μετακινήσεις", "City & transport", "Ville & transports", "Stadt & Verkehr", "Ciudad y transporte", "Città e trasporti", "Город и транспорт", "Miasto i transport", "Şehir ve ulaşım"],
  expressions: ["Εκφράσεις", "Idioms & expressions", "Expressions idiomatiques", "Redewendungen", "Expresiones", "Modi di dire", "Идиомы и выражения", "Idiomy i wyrażenia", "Deyimler ve ifadeler"],
  connectors: ["Συνδετικά", "Connectors & nuance", "Mots pour argumenter", "Konnektoren & Nuancen", "Conectores y matices", "Connettivi e sfumature", "Связки и оттенки", "Spójniki i niuanse", "Bağlaçlar ve nüanslar"],
  ideas: ["Αφηρημένες έννοιες", "Ideas & abstract notions", "Notions abstraites", "Begriffe & Abstraktes", "Ideas y nociones abstractas", "Idee e concetti astratti", "Понятия и абстракции", "Pojęcia abstrakcyjne", "Kavramlar ve soyut fikirler"],
};

export const THEME_IDS = Object.keys(T);
export const themeGr = (id) => (T[id] || T.ideas)[0];
export const themeName = (id) => (T[id] || T.ideas)[1 + LANGS.indexOf(getLang())] || (T[id] || T.ideas)[1];
