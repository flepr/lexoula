// Λεξούλα — ce que l'appli lit à voix haute, et le nom du fichier audio correspondant.
// Module partagé par l'appli (src/) et la fonction serveur « audio » : les deux doivent calculer
// exactement le même texte et la même clé, sinon l'appli ne trouve pas le fichier et repasse sur la voix de l'appareil.

// mot vedette : « η ενσυναίσθηση » (sans la variante après « · » ni la terminaison « , -ες »)
export const headword = (w) => String(w?.gr || "").split(" · ")[0].replace(/, -.*$/, "");
// forme lue sur le bouton haut-parleur : adjectifs aux trois genres, sinon l'entrée sans terminaison
export const speakForm = (w) =>
  (w?.fem ? `${w.ans?.[0] || headword(w)}, ${w.fem}, ${w.neu}` : String(w?.gr || "").replace(/, -.*$/, ""));
// paragraphe d'un texte : on retire les balises [[forme|N]]
export const plainText = (gr) => String(gr || "").replace(/\[\[([^|\]]+)\|[^\]]+\]\]/g, "$1");

// « ο/η συνοδηγός » → « ο συνοδηγός, η συνοδηγός » ; « · » et « / » deviennent des virgules
export function speechText(t) {
  return String(t || "")
    .replace(/\[\[([^|\]]+)\|[^\]]+\]\]/g, "$1")
    .replace(/(^|[\s(«])(ο|η|το)\/(ο|η|το)\s+([^\s,·;.]+)/g, (m, p, a, b, w) => `${p}${a} ${w}, ${b} ${w}`)
    .replace(/·/g, ",")
    .replace(/\s\/\s/g, ", ");
}

// texte exact envoyé à la synthèse
export const spoken = (t) => speechText(t).normalize("NFC").replace(/[ \t]+/g, " ").replace(/\s*\n\s*/g, "\n").trim();

// empreinte synchrone (deux cyrb53, 106 bits) : calculable sans attendre au moment du clic
function cyrb53(str, seed) {
  let h1 = 0xdeadbeef ^ seed, h2 = 0x41c6ce57 ^ seed;
  for (let i = 0; i < str.length; i++) {
    const ch = str.charCodeAt(i);
    h1 = Math.imul(h1 ^ ch, 2654435761);
    h2 = Math.imul(h2 ^ ch, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return (4294967296 * (2097151 & h2) + (h1 >>> 0)).toString(16).padStart(14, "0");
}
export const AUDIO_VERSION = "v1"; // à changer pour tout régénérer (autre voix, autre consigne)
export const audioKey = (t) => {
  const s = spoken(t);
  return s ? `${AUDIO_VERSION}-${cyrb53(s, 1)}${cyrb53(s, 7)}` : "";
};
export const AUDIO_BUCKET = "audio";

// tout ce que l'appli peut lire pour un mot
export const lexemeSpeech = (w) => [headword(w), speakForm(w), w?.ex].filter(Boolean);
