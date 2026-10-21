import { DefaultValueConverter, type CstNode, type GrammarAST, type ValueType } from 'langium';

/**
 * Reads Alloy number literals as the Analyzer does: decimal, and `0x` hex
 * and `0b` binary with `_` allowed as a digit separator.
 */
export class AlloyLspValueConverter extends DefaultValueConverter {

    protected override runConverter(rule: GrammarAST.AbstractRule, input: string, cstNode: CstNode): ValueType {
        if (rule.name === 'NUMBER') {
            return Number(input.replace(/_/g, ''));
        }
        return super.runConverter(rule, input, cstNode);
    }

}
