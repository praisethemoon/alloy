/** An XML element: its name, attributes and child elements. Text content is not kept. */
export interface XmlElement {
    name: string;
    attributes: Record<string, string>;
    children: XmlElement[];
}

const entities: Record<string, string> = { lt: '<', gt: '>', amp: '&', quot: '"', apos: "'" };

function decode(text: string): string {
    return text.replace(/&(#x[0-9a-fA-F]+|#[0-9]+|[a-z]+);/g, (whole, entity: string) =>
        entity.startsWith('#x') ? String.fromCodePoint(parseInt(entity.slice(2), 16))
            : entity.startsWith('#') ? String.fromCodePoint(parseInt(entity.slice(1), 10))
                : entities[entity] ?? whole);
}

/**
 * Parses the XML the Alloy Analyzer writes for instances and metamodels:
 * elements and attributes only, which is all that format uses. Runs the same
 * in the webview and under Node, so no DOM is needed.
 */
export function parseXml(text: string): XmlElement {
    const root: XmlElement = { name: '#document', attributes: {}, children: [] };
    const stack = [root];
    const tag = /<(\/?)([A-Za-z_][\w.:-]*)((?:\s+[\w.:-]+\s*=\s*(?:"[^"]*"|'[^']*'))*)\s*(\/?)>|<!--[\s\S]*?-->|<\?[\s\S]*?\?>|<!\[CDATA\[[\s\S]*?\]\]>|<![^>]*>/g;
    const attribute = /([\w.:-]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/g;
    for (let match = tag.exec(text); match; match = tag.exec(text)) {
        const [, closing, name, attributeText, selfClosing] = match;
        if (!name) continue;
        if (closing) {
            if (stack.length > 1 && stack[stack.length - 1].name === name) stack.pop();
            else throw new Error(`Unexpected </${name}> at ${match.index}.`);
            continue;
        }
        const element: XmlElement = { name, attributes: {}, children: [] };
        for (let a = attribute.exec(attributeText); a; a = attribute.exec(attributeText)) {
            element.attributes[a[1]] = decode(a[2] ?? a[3] ?? '');
        }
        attribute.lastIndex = 0;
        stack[stack.length - 1].children.push(element);
        if (!selfClosing) stack.push(element);
    }
    if (stack.length > 1) throw new Error(`<${stack[stack.length - 1].name}> is never closed.`);
    return root;
}
