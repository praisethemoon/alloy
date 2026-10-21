import { DefaultTokenBuilder, type Grammar, type TokenBuilderOptions } from 'langium';
import type { IToken, TokenType, TokenVocabulary } from 'chevrotain';

const badName = /[0-9]+[$a-zA-Z_"][$0-9a-zA-Z_"]*/y;
const hexOrBinary = /0x(?:_|[0-9A-Fa-f]{2})+|0b[01_]+/y;

/**
 * Alloy.lex rejects a name that starts with a digit, such as 1_000 or 3x,
 * unless a hex or binary number matches at least as far (JFlex takes the
 * longest match, and the number rules come first). This token is that rule:
 * no grammar rule accepts it, so wherever it matches the parse fails, as in
 * the Analyzer, instead of reading a number followed by a name.
 */
export const NAME_STARTING_WITH_DIGIT: TokenType = {
    name: 'NAME_STARTING_WITH_DIGIT',
    PATTERN: (text: string, offset: number) => {
        badName.lastIndex = offset;
        const name = badName.exec(text);
        if (!name) return null;
        hexOrBinary.lastIndex = offset;
        const number = hexOrBinary.exec(text);
        return number && number[0].length >= name[0].length ? null : name;
    },
    LINE_BREAKS: false,
    START_CHARS_HINT: ['0', '1', '2', '3', '4', '5', '6', '7', '8', '9']
} as TokenType;

const arrowMult = /(?:some|one|lone|set)(?![$0-9a-zA-Z_"\u00C0-\u2017\u201A-\uFFFF])/y;

/**
 * CompFilter merges -> with a following some/one/lone/set into one token,
 * so after -> they are always a multiplicity, never a quantifier. This
 * pattern matches them only there, and comes before the keywords.
 */
function matchArrowMult(text: string, offset: number, tokens: IToken[]): RegExpExecArray | null {
    if (tokens.at(-1)?.tokenType.name !== '->') return null;
    arrowMult.lastIndex = offset;
    return arrowMult.exec(text);
}

/**
 * Adds the Analyzer's "name cannot start with a number" token ahead of
 * numbers, and moves the multiplicity after -> ahead of the keywords.
 */
export class AlloyTokenBuilder extends DefaultTokenBuilder {

    override buildTokens(grammar: Grammar, options?: TokenBuilderOptions): TokenVocabulary {
        const tokens = super.buildTokens(grammar, options) as TokenType[];
        const number = tokens.findIndex(token => token.name === 'NUMBER');
        tokens.splice(number < 0 ? tokens.length : number, 0, NAME_STARTING_WITH_DIGIT);
        const mult = tokens.findIndex(token => token.name === 'ARROW_MULT');
        if (mult >= 0) {
            const [token] = tokens.splice(mult, 1);
            Object.assign(token, { PATTERN: matchArrowMult, LINE_BREAKS: false, START_CHARS_HINT: ['s', 'o', 'l'] });
            tokens.unshift(token);
        }
        return tokens;
    }
}
