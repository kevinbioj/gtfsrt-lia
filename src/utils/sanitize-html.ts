/** Ce dont le contenu n'est pas du texte : il part avec la balise, et non à sa place. */
const OPAQUE = new Set(["script", "style"]);

/**
 * Les éléments qui, en texte brut, se détachent de ce qui les entoure par une ligne vide. Les autres
 * — `<span>`, `<strong>`… — se fondent dans la phrase qui les porte.
 */
const TEXT_BLOCKS = new Set([
	"p",
	"div",
	"h1",
	"h2",
	"h3",
	"h4",
	"h5",
	"h6",
	"ul",
	"ol",
	"table",
	"tr",
	"figure",
	"blockquote",
]);

/** Une balise, ouvrante ou fermante, ses attributs compris — guillemets respectés. */
const TAG = /<(\/?)([a-zA-Z][a-zA-Z0-9]*)((?:[^>"']|"[^"]*"|'[^']*')*)>/g;

/**
 * Le HTML d'une info trafic, ramené à du texte brut : c'est ce que la spécification GTFS-RT attend
 * d'une `description_text`, sans balise ni image.
 *
 * La structure se lit encore, en lignes : un paragraphe se détache par une ligne vide, une puce par
 * un « • » en tête de ligne, les puces d'une même liste se suivant sans ligne vide. Les images
 * sautent.
 *
 * Un lien garde son adresse, entre parenthèses derrière son texte : « Plus d'infos ICI » n'a de sens
 * qu'avec.
 */
export function htmlToText(raw: string): string {
	if (raw.length === 0) return "";

	let out = "";
	/** Les sauts de ligne que la balise précédente réclame, écrits seulement si du texte suit. */
	let pendingBreaks = 0;
	/** Une puce ouverte qui attend son texte. */
	let pendingBullet = false;
	/** Profondeur dans les `<li>` : un bloc qui s'y trouve ne va qu'à la ligne. */
	let itemDepth = 0;
	/** Le lien en cours, dont le texte est retenu jusqu'à sa fermeture. */
	let link: { href: string | undefined; text: string } | null = null;
	let skipping: string | null = null;
	let cursor = 0;

	const requestBreaks = (count: number) => {
		// Une puce encore vide ne se laisse pas repousser : son texte lui revient, fût-il dans un bloc.
		if (!pendingBullet) pendingBreaks = Math.max(pendingBreaks, count);
	};
	const write = (text: string) => {
		if (link !== null) {
			link.text += text;
			return;
		}
		const content = pendingBreaks > 0 || pendingBullet ? text.trimStart() : text;
		if (content.length === 0) return;
		if (out.length > 0) out += "\n".repeat(pendingBreaks);
		if (pendingBullet) out += "• ";
		out += content;
		pendingBreaks = 0;
		pendingBullet = false;
	};
	const writeText = (text: string) => write(decodeEntities(text).replace(/\s+/g, " "));

	for (const match of raw.matchAll(TAG)) {
		const [tag, closing, rawName, attributes] = match as unknown as [string, string, string, string];
		const name = rawName.toLowerCase();

		if (skipping === null) writeText(raw.slice(cursor, match.index));
		cursor = match.index + tag.length;

		if (skipping !== null) {
			if (closing === "/" && name === skipping) skipping = null;
			continue;
		}
		if (OPAQUE.has(name)) {
			if (closing !== "/") skipping = name;
			continue;
		}

		if (name === "a") {
			if (closing !== "/") {
				link = { href: attributeOf(attributes, "href"), text: "" };
				continue;
			}
			if (link === null) continue;
			const { href, text } = link;
			link = null;
			const label = text.trim();
			if (href === undefined || href.length === 0) write(label);
			else write(label.length === 0 || label === href ? href : `${label} (${href})`);
		} else if (name === "li") {
			if (closing !== "/") {
				requestBreaks(1);
				pendingBullet = true;
				itemDepth += 1;
			} else if (itemDepth > 0) {
				itemDepth -= 1;
				pendingBullet = false;
			}
		} else if (name === "br") {
			requestBreaks(1);
		} else if (name === "hr") {
			requestBreaks(2);
		} else if (name === "td" || name === "th") {
			if (closing === "/") write(" ");
		} else if (TEXT_BLOCKS.has(name)) {
			requestBreaks(itemDepth > 0 ? 1 : 2);
		}
	}

	if (skipping === null) writeText(raw.slice(cursor));
	if (link !== null) {
		const { text } = link;
		link = null;
		write(text);
	}

	return out
		.split("\n")
		.map((line) => line.trim())
		.join("\n")
		.replace(/\n{3,}/g, "\n\n")
		.trim();
}

// ---

/** La valeur d'un attribut, guillemets simples ou doubles, ou `undefined` s'il n'y est pas. */
function attributeOf(attributes: string, name: string): string | undefined {
	const match = new RegExp(`(?:^|\\s)${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)')`, "i").exec(attributes);
	if (match === null) return undefined;
	return decodeEntities(match[1] ?? match[2] ?? "");
}

/** Les entités nommées que le CMS amont écrit ; les autres restent telles quelles. */
const NAMED_ENTITIES = new Map([
	["amp", "&"],
	["lt", "<"],
	["gt", ">"],
	["quot", '"'],
	["apos", "'"],
	["nbsp", " "],
]);

/**
 * Les entités d'une valeur d'attribut ou d'un texte, décodées en une seule passe — qu'un `&amp;lt;`
 * redevienne `&lt;`, et non `<`.
 */
function decodeEntities(value: string): string {
	return value.replace(/&(#[xX][0-9a-fA-F]+|#[0-9]+|[a-zA-Z]+);/g, (entity, body: string) => {
		if (!body.startsWith("#")) return NAMED_ENTITIES.get(body.toLowerCase()) ?? entity;

		const code = body[1] === "x" || body[1] === "X" ? Number.parseInt(body.slice(2), 16) : Number(body.slice(1));
		return code <= 0x10ffff ? String.fromCodePoint(code) : entity;
	});
}
