import { WorkspaceCache, type AstNode, type LangiumDocument } from 'langium';
import type { AlloyLspServices } from './alloy-lsp-module.js';
import { parameterCount } from './alloy-lsp-linker.js';
import {
    isDeclName, isEnumDecl, isEnumMember, isFunDecl, isJoinExpr, isLetBinding,
    isMacroDecl, isModuleParam, isNameExpr, isPredDecl, isSigDecl, isSigName,
    type BoxJoinExpr, type Decl, type DeclName, type EnumDecl, type EnumMember, type Expr, type FunDecl, type JoinExpr,
    type PredDecl, type SigDecl, type SigName, type SigRef, type Specification
} from './generated/ast.js';

// ------------------------------------------------------------------ types

/** A basic type: a declared sig or enum, or one of Alloy's own. */
export type BasicType = SigName | EnumDecl | EnumMember | 'univ' | 'none' | 'Int' | 'String';

/** A product of basic types, one per column. */
export type RelationType = readonly BasicType[];

/**
 * What an expression denotes: a formula, an integer, a union of relation
 * types, or unknown when something it depends on could not be typed (an
 * unresolved name, a macro), in which case no diagnostic is reported for it.
 */
export type AlloyType =
    | { kind: 'formula' }
    | { kind: 'int' }
    | { kind: 'relation', relations: readonly RelationType[] }
    | { kind: 'unknown' };

const FORMULA: AlloyType = { kind: 'formula' };
const INT: AlloyType = { kind: 'int' };
const UNKNOWN: AlloyType = { kind: 'unknown' };

function relation(...relations: RelationType[]): AlloyType {
    return { kind: 'relation', relations };
}

export function basicName(basic: BasicType): string {
    return typeof basic === 'string' ? basic : basic.name;
}

/** `A->B + C`, `formula`, `Int`, or `unknown`. */
export function typeToString(type: AlloyType): string {
    switch (type.kind) {
        case 'formula': return 'formula';
        case 'int': return 'Int';
        case 'unknown': return 'unknown';
        case 'relation': return type.relations.length === 0 ? 'none'
            : type.relations.map(r => r.map(basicName).join('->')).join(' + ');
    }
}

function arities(type: AlloyType): Set<number> {
    if (type.kind === 'int') return new Set([1]);
    return new Set(type.kind === 'relation' ? type.relations.map(r => r.length) : []);
}

function arityText(type: AlloyType): string {
    return [...arities(type)].sort().join(' or ');
}

/** A problem found while typing an expression. */
export interface TypeIssue {
    severity: 'error' | 'warning';
    message: string;
    node: AstNode;
}

// ---------------------------------------------------------------- lattice

/** The sig a basic type extends: its parent sig or enum, or univ at the top. */
function parentOf(basic: BasicType): BasicType | undefined {
    if (typeof basic === 'string') return basic === 'univ' ? undefined : 'univ';
    if (isEnumMember(basic)) return basic.$container;
    if (isEnumDecl(basic)) return 'univ';
    const parent = basic.$container.extends;
    if (!parent) return 'univ';
    if (parent.builtin) return parent.builtin === 'Int' ? 'Int' : 'univ';
    const target = parent.ref?.ref;
    return isSigName(target) || isEnumDecl(target) ? target : 'univ';
}

/** Whether `sub` is `sup` or lies below it, following extends. */
function isSubtype(sub: BasicType, sup: BasicType): boolean {
    if (sup === 'univ' || sub === 'none') return true;
    const seen = new Set<BasicType>();
    for (let current: BasicType | undefined = sub; current && !seen.has(current); current = parentOf(current)) {
        if (current === sup) return true;
        seen.add(current);
    }
    return false;
}

/** The common part of two basic types, which only exists when one lies below the other. */
function meet(a: BasicType, b: BasicType): BasicType | undefined {
    if (isSubtype(a, b)) return a;
    if (isSubtype(b, a)) return b;
    return undefined;
}

/** Whether two basic types can share atoms. */
export function overlaps(a: BasicType, b: BasicType): boolean {
    return meet(a, b) !== undefined;
}

function meetRelations(a: RelationType, b: RelationType): RelationType | undefined {
    if (a.length !== b.length) return undefined;
    const result: BasicType[] = [];
    for (let i = 0; i < a.length; i++) {
        const m = meet(a[i], b[i]);
        if (!m) return undefined;
        result.push(m);
    }
    return result;
}

// -------------------------------------------------------------- inference

/** Expression positions that expect a formula rather than a set or relation. */
type Expectation = 'formula' | 'expression' | 'either';

/**
 * Alloy's relational type inference. Types are computed on demand and kept
 * until the workspace changes; the issues found on the way are collected per
 * document for the validator.
 */
export class AlloyTypeSystem {

    protected readonly types: WorkspaceCache<AstNode, AlloyType>;
    protected readonly issueLists: WorkspaceCache<string, TypeIssue[]>;
    protected readonly inProgress = new Set<AstNode>();

    constructor(services: AlloyLspServices) {
        this.types = new WorkspaceCache(services.shared);
        this.issueLists = new WorkspaceCache(services.shared);
    }

    /** Every type issue of a document, typing all of its expressions first. */
    issues(document: LangiumDocument<Specification>): TypeIssue[] {
        return this.issueLists.get(document.uri.toString(), () => {
            const issues: TypeIssue[] = [];
            this.checkSpecification(document.parseResult.value, issues);
            return issues;
        });
    }

    /** The type of an expression, or of a declaration's name. */
    typeOf(node: AstNode): AlloyType {
        const cached = this.types.get(node);
        if (cached) return cached;
        if (this.inProgress.has(node)) return UNKNOWN;
        this.inProgress.add(node);
        try {
            const type = this.compute(node, []);
            this.types.set(node, type);
            return type;
        } finally {
            this.inProgress.delete(node);
        }
    }

    // --- whole-document checking

    protected checkSpecification(spec: Specification, issues: TypeIssue[]): void {
        for (const paragraph of spec.paragraphs) {
            switch (paragraph.$type) {
                case 'SigDecl':
                    paragraph.fields.forEach(field => this.check(field.type, 'expression', issues));
                    if (paragraph.block) this.check(paragraph.block, 'formula', issues);
                    break;
                case 'FactDecl':
                case 'AssertDecl':
                    this.check(paragraph.body, 'formula', issues);
                    break;
                case 'PredDecl':
                    paragraph.params.forEach(param => this.check(param.type, 'expression', issues));
                    this.check(paragraph.body, 'formula', issues);
                    break;
                case 'FunDecl':
                    paragraph.params.forEach(param => this.check(param.type, 'expression', issues));
                    this.check(paragraph.returnType, 'expression', issues);
                    this.checkFunBody(paragraph, issues);
                    break;
                case 'MacroDecl':
                    break;
                case 'Command':
                    paragraph.calls.forEach(call => { if (call.body) this.check(call.body, 'formula', issues); });
                    break;
            }
        }
    }

    protected checkFunBody(fun: FunDecl, issues: TypeIssue[]): void {
        const exprs = fun.body.exprs;
        if (exprs.length === 1) {
            this.check(exprs[0], 'expression', issues);
        } else {
            exprs.forEach(e => this.check(e, 'either', issues));
        }
    }

    /** Types `expr` in a position expecting `expected`, recording what is wrong with it. */
    protected check(expr: Expr, expected: Expectation, issues: TypeIssue[]): AlloyType {
        const type = this.compute(expr, issues);
        this.types.set(expr, type);
        if (expected === 'formula' && (type.kind === 'relation' || type.kind === 'int')) {
            issues.push({ severity: 'error', node: expr, message: `This must be a formula, but it is an expression of type ${typeToString(type)}.` });
        } else if (expected === 'expression' && type.kind === 'formula') {
            issues.push({ severity: 'error', node: expr, message: 'This must be a set, relation or integer expression, but it is a formula.' });
        }
        return type;
    }

    // --- computing one node's type

    protected compute(node: AstNode, issues: TypeIssue[]): AlloyType {
        if (isDeclName(node)) return this.declNameType(node, issues);
        const e = node as Expr;
        switch (e.$type) {
            case 'NumberLiteral': return INT;
            case 'StringLiteral': return relation(['String']);
            case 'ConstantExpr':
                if (e.value === 'iden') return relation(['univ', 'univ']);
                if (e.value === 'this') return this.thisType(e);
                return INT;
            case 'BuiltinSigExpr':
                switch (e.name) {
                    case 'none': return relation(['none']);
                    case 'Int': case 'seq/Int': return relation(['Int']);
                    case 'String': return relation(['String']);
                    default: return relation(['univ']);
                }
            case 'NameExpr':
                return this.implicitThisType(e) ?? this.referenceType(e.ref.ref);
            case 'AtNameExpr':
                return this.referenceType(e.ref.ref);
            case 'PrimeExpr': return this.check(e.operand, 'either', issues);
            case 'SequenceExpr':
                this.check(e.left, 'formula', issues);
                this.check(e.right, 'formula', issues);
                return FORMULA;
            case 'Block':
                e.exprs.forEach(x => this.check(x, 'formula', issues));
                return FORMULA;
            case 'LetExpr':
                e.bindings.forEach(b => this.types.set(b, this.check(b.value, 'either', issues)));
                return this.check(e.body, 'either', issues);
            case 'QuantifiedExpr':
                e.decls.forEach(d => this.check(d.type, 'expression', issues));
                if (e.quantifier === 'sum') {
                    this.check(e.body, 'expression', issues);
                    return INT;
                }
                this.check(e.body, 'formula', issues);
                return FORMULA;
            case 'Comprehension': {
                const columns: RelationType[][] = [];
                for (const decl of e.decls) {
                    const bound = this.check(decl.type, 'expression', issues);
                    const sets = bound.kind === 'relation' ? bound.relations.filter(r => r.length === 1) : [];
                    if (bound.kind === 'unknown') return UNKNOWN;
                    for (const _name of decl.names) columns.push(sets);
                }
                if (e.body) this.check(e.body, 'formula', issues);
                return relation(...product(columns));
            }
            case 'ImpliesExpr': {
                this.check(e.condition, 'formula', issues);
                const then = this.check(e.then, 'either', issues);
                if (!e.else) return FORMULA;
                const otherwise = this.check(e.else, 'either', issues);
                return then.kind === 'relation' && otherwise.kind === 'relation'
                    ? relation(...then.relations, ...otherwise.relations)
                    : then.kind === 'unknown' ? otherwise : then;
            }
            case 'UnaryExpr': return this.unaryType(e, issues);
            case 'BinaryExpr': return this.binaryType(e, issues);
            case 'ArrowExpr': {
                const left = this.check(e.left, 'expression', issues);
                const right = this.check(e.right, 'expression', issues);
                const l = asRelation(left), r = asRelation(right);
                if (!l || !r) return UNKNOWN;
                return relation(...l.flatMap(a => r.map(b => [...a, ...b])));
            }
            case 'JoinExpr': return this.joinType(e, issues);
            case 'BoxJoinExpr': return this.boxJoinType(e, issues);
            case 'BuiltinCall':
                e.args.forEach(a => this.check(a, 'expression', issues));
                return e.fn === 'int' || e.fn === 'sum' ? INT : FORMULA;
            case 'BuiltinRef':
                return e.fn === 'int' || e.fn === 'sum' ? INT : FORMULA;
        }
        return UNKNOWN;
    }

    /** `this` is the sig of the enclosing signature fact or the receiver of the enclosing pred or fun. */
    protected thisType(node: AstNode): AlloyType {
        for (let current = node.$container; current; current = current.$container) {
            if (isSigDecl(current)) return relation(...current.names.map(n => [n]));
            if ((isPredDecl(current) || isFunDecl(current)) && current.receiver) {
                return this.sigRefType(current.receiver);
            }
        }
        return UNKNOWN;
    }

    protected sigRefType(ref: SigRef): AlloyType {
        if (ref.builtin) {
            return ref.builtin === 'none' ? relation(['none'])
                : ref.builtin === 'Int' || ref.builtin === 'seq/Int' ? relation(['Int'])
                : ref.builtin === 'String' ? relation(['String']) : relation(['univ']);
        }
        return this.referenceType(ref.ref?.ref);
    }

    /**
     * Inside a signature fact, a field of that sig or of one it extends
     * stands for `this.field`, so its type loses the sig column. Undefined
     * when the name is not such a field.
     */
    protected implicitThisType(name: Expr & { $type: 'NameExpr' }): AlloyType | undefined {
        const field = name.ref.ref;
        if (!isDeclName(field) || !isSigDecl(field.$container.$container)) return undefined;
        const owner = field.$container.$container;
        let child: AstNode = name;
        for (let current: AstNode | undefined = name.$container; current; child = current, current = current.$container) {
            if (isSigDecl(current)) {
                if (current.block !== child || !extendsOrIs(current, owner)) return undefined;
                const columns = asRelation(this.typeOf(field));
                return columns ? relation(...columns.map(r => r.slice(1))) : UNKNOWN;
            }
        }
        return undefined;
    }

    /** What a name denotes. Calls never get here: joins type them by their result. */
    protected referenceType(target: AstNode | undefined): AlloyType {
        if (!target) return UNKNOWN;
        if (isSigName(target)) return this.sigType(target);
        if (isEnumDecl(target) || isEnumMember(target)) return relation([target]);
        if (isModuleParam(target)) return relation(['univ']);
        if (isDeclName(target) || isLetBinding(target)) return this.typeOf(target);
        if (isFunDecl(target)) return this.funResult(target);
        if (isPredDecl(target)) return FORMULA;
        return UNKNOWN;
    }

    /** A sig's type: itself, or for a subset sig the union of its parents' types. */
    protected sigType(sig: SigName): AlloyType {
        const decl = sig.$container;
        if (decl.in.length === 0 && decl.equals.length === 0) return relation([sig]);
        if (this.inProgress.has(sig)) return relation(['univ']);
        this.inProgress.add(sig);
        try {
            const parents = [...decl.in, ...decl.equals].map(p => this.sigRefType(p));
            if (parents.some(p => p.kind !== 'relation')) return relation(['univ']);
            return relation(...parents.flatMap(p => (p as { relations: readonly RelationType[] }).relations));
        } finally {
            this.inProgress.delete(sig);
        }
    }

    /** A field's type is its sig times its bound; a variable's or parameter's type is its bound. */
    protected declNameType(name: DeclName, issues: TypeIssue[]): AlloyType {
        const decl = name.$container;
        const bound = boundType(this.compute(decl.type, issues));
        const owner = decl.$container;
        if (!isSigDecl(owner)) return bound;
        const columns = asRelation(bound);
        if (!columns) return UNKNOWN;
        return relation(...owner.names.flatMap(sig => columns.map(c => [sig, ...c])));
    }

    protected funResult(fun: FunDecl): AlloyType {
        return boundType(this.typeOf(fun.returnType));
    }

    // --- operators

    protected unaryType(e: Expr & { $type: 'UnaryExpr' }, issues: TypeIssue[]): AlloyType {
        switch (e.op) {
            case '!': case 'not': case 'always': case 'eventually': case 'after':
            case 'historically': case 'once': case 'before':
                this.check(e.operand, 'formula', issues);
                return FORMULA;
            case 'no': case 'some': case 'lone': case 'one':
                if (isMultiplicityBound(e)) return this.check(e.operand, 'expression', issues);
                this.check(e.operand, 'expression', issues);
                return FORMULA;
            case 'set':
                return this.check(e.operand, 'expression', issues);
            case 'seq': {
                const element = asRelation(this.check(e.operand, 'expression', issues));
                return element ? relation(...element.map(r => ['Int' as BasicType, ...r])) : UNKNOWN;
            }
            case '#': case 'sum': case 'int':
                this.check(e.operand, 'expression', issues);
                return INT;
            case '~': case '^': case '*': {
                const operand = this.check(e.operand, 'expression', issues);
                if (operand.kind !== 'relation') return UNKNOWN;
                const binary = operand.relations.filter(r => r.length === 2);
                if (binary.length === 0) {
                    issues.push({ severity: 'error', node: e, message: `${e.op} needs a binary relation, but its operand has arity ${arityText(operand)}.` });
                    return UNKNOWN;
                }
                if (e.op === '~') return relation(...binary.map(([a, b]) => [b, a]));
                return e.op === '*' ? relation(...binary, ['univ', 'univ']) : relation(...binary);
            }
        }
        return UNKNOWN;
    }

    protected binaryType(e: Expr & { $type: 'BinaryExpr' }, issues: TypeIssue[]): AlloyType {
        const op = e.op;
        if (['||', 'or', '<=>', 'iff', '&&', 'and', 'until', 'releases', 'since', 'triggered'].includes(op)) {
            this.check(e.left, 'formula', issues);
            this.check(e.right, 'formula', issues);
            return FORMULA;
        }
        const left = this.check(e.left, 'expression', issues);
        const right = this.check(e.right, 'expression', issues);
        if (left.kind === 'unknown' || right.kind === 'unknown') {
            return isComparison(op) ? FORMULA : UNKNOWN;
        }
        if (isComparison(op)) {
            const ordering = /[<>]/.test(op.replace('!', ''));
            if (!ordering && !(left.kind === 'int' || right.kind === 'int')) {
                this.requireSameArity(e, op, left, right, issues);
            }
            return FORMULA;
        }
        if (['<<', '>>', '>>>'].includes(op) || op.startsWith('fun/')) return INT;
        if ((op === '+' || op === '-') && left.kind === 'int' && right.kind === 'int') return INT;
        const l = asRelation(left), r = asRelation(right);
        if (!l || !r) return UNKNOWN;
        switch (op) {
            case '+': case '-': case '++': {
                if (!this.requireSameArity(e, op, left, right, issues)) return UNKNOWN;
                if (op === '-') return relation(...l);
                if (op === '++' && !l.some(a => r.some(b => meetRelations(a, b)))) {
                    issues.push({ severity: 'warning', node: e, message: `${typeToString(left)} and ${typeToString(right)} never overlap, so ++ is just a union here.` });
                }
                return relation(...l, ...r);
            }
            case '&': {
                if (!this.requireSameArity(e, op, left, right, issues)) return UNKNOWN;
                const meets = l.flatMap(a => r.map(b => meetRelations(a, b)).filter((m): m is RelationType => !!m));
                if (meets.length === 0) {
                    issues.push({ severity: 'warning', node: e, message: `This intersection is always empty: ${typeToString(left)} and ${typeToString(right)} are disjoint.` });
                }
                return relation(...meets);
            }
            case '<:': {
                if (!l.some(a => a.length === 1)) {
                    issues.push({ severity: 'error', node: e.left, message: `The left side of <: must be a set, but it has arity ${arityText(left)}.` });
                    return UNKNOWN;
                }
                const kept = r.filter(b => l.some(a => a.length === 1 && meet(a[0], b[0])));
                if (kept.length === 0) {
                    issues.push({ severity: 'warning', node: e, message: `This restriction is always empty: ${typeToString(left)} is disjoint from the domain of ${typeToString(right)}.` });
                }
                return relation(...kept.map(b => [meetFirst(l, b[0]), ...b.slice(1)]));
            }
            case ':>': {
                if (!r.some(b => b.length === 1)) {
                    issues.push({ severity: 'error', node: e.right, message: `The right side of :> must be a set, but it has arity ${arityText(right)}.` });
                    return UNKNOWN;
                }
                const kept = l.filter(a => r.some(b => b.length === 1 && meet(a[a.length - 1], b[0])));
                if (kept.length === 0) {
                    issues.push({ severity: 'warning', node: e, message: `This restriction is always empty: ${typeToString(right)} is disjoint from the range of ${typeToString(left)}.` });
                }
                return relation(...kept);
            }
        }
        return UNKNOWN;
    }

    protected requireSameArity(e: AstNode, op: string, left: AlloyType, right: AlloyType, issues: TypeIssue[]): boolean {
        const l = arities(left), r = arities(right);
        if ([...l].some(a => r.has(a))) return true;
        issues.push({ severity: 'error', node: e, message: `${op} needs operands of the same arity, but the left side has arity ${arityText(left)} and the right side ${arityText(right)}.` });
        return false;
    }

    protected joinType(e: JoinExpr, issues: TypeIssue[]): AlloyType {
        const callee = calleeOf(e.right);
        if (callee) {
            this.check(e.left, 'expression', issues);
            return isPredDecl(callee) ? FORMULA : this.funResult(callee);
        }
        const left = this.check(e.left, 'expression', issues);
        if (e.right.$type === 'BuiltinRef') return e.right.fn === 'int' || e.right.fn === 'sum' ? INT : FORMULA;
        const right = this.check(e.right, 'expression', issues);
        return this.join(e, left, right, issues);
    }

    protected boxJoinType(e: BoxJoinExpr, issues: TypeIssue[]): AlloyType {
        const callee = calleeOf(e.target) ?? (isJoinExpr(e.target) ? calleeOf(e.target.right) : undefined);
        if (callee) {
            if (isJoinExpr(e.target)) this.check(e.target.left, 'expression', issues);
            e.args.forEach(a => this.check(a, 'expression', issues));
            return isPredDecl(callee) ? FORMULA : this.funResult(callee);
        }
        if (e.target.$type === 'BuiltinSigExpr' && e.target.name === 'Int') {
            // Int[i] turns the integer i into its Int atom
            e.args.forEach(a => this.check(a, 'expression', issues));
            return relation(['Int']);
        }
        if (isNameExpr(e.target) && isMacroDecl(e.target.ref.ref)) {
            e.args.forEach(a => this.check(a, 'either', issues));
            return UNKNOWN;
        }
        // e[a, b] is b.(a.e)
        let result = this.check(e.target, 'expression', issues);
        for (const arg of e.args) {
            result = this.join(e, this.check(arg, 'expression', issues), result, issues);
        }
        return result;
    }

    protected join(at: AstNode, left: AlloyType, right: AlloyType, issues: TypeIssue[]): AlloyType {
        const l = asRelation(left), r = asRelation(right);
        if (!l || !r) return UNKNOWN;
        if (l.every(a => a.length === 1) && r.every(b => b.length === 1)) {
            issues.push({ severity: 'error', node: at, message: `A join needs a relation on at least one side, but both sides are sets (${typeToString(left)} and ${typeToString(right)}).` });
            return UNKNOWN;
        }
        const joined: RelationType[] = [];
        for (const a of l) {
            for (const b of r) {
                if (a.length + b.length < 3) continue;
                const m = meet(a[a.length - 1], b[0]);
                if (m) joined.push([...a.slice(0, -1), ...b.slice(1)]);
            }
        }
        if (joined.length === 0) {
            issues.push({ severity: 'warning', node: at, message: `This join is always empty: no column of ${typeToString(left)} meets ${typeToString(right)}.` });
        }
        return relation(...joined);
    }
}

function isComparison(op: string): boolean {
    return /^(!|not)?(in|=|<|>|=<|<=|>=)$/.test(op);
}

/** Whether a multiplicity keyword bounds a declaration (`x: some A`) rather than testing a set. */
function isMultiplicityBound(e: AstNode): boolean {
    const parent = e.$container;
    return parent?.$type === 'Decl' && (parent as Decl).type === e
        || isFunDecl(parent) && parent.returnType === e;
}

/** A declaration bound's type with multiplicity keywords dropped; `set A` and `one A` are both A. */
function boundType(type: AlloyType): AlloyType {
    return type.kind === 'formula' ? UNKNOWN : type;
}

/**
 * The pred or fun a name calls, if it names one that takes parameters. A
 * parameterless fun is a relation like any other: `next[x]` joins x with it.
 */
function calleeOf(node: AstNode): FunDecl | PredDecl | undefined {
    if (!isNameExpr(node)) return undefined;
    const target = node.ref.ref;
    return (isFunDecl(target) || isPredDecl(target)) && (parameterCount(target) ?? 0) > 0 ? target : undefined;
}

function asRelation(type: AlloyType): readonly RelationType[] | undefined {
    if (type.kind === 'relation') return type.relations;
    if (type.kind === 'int') return [['Int']];
    return undefined;
}

function meetFirst(sets: readonly RelationType[], basic: BasicType): BasicType {
    for (const s of sets) {
        const m = s.length === 1 ? meet(s[0], basic) : undefined;
        if (m) return m;
    }
    return basic;
}

/** The sig whose signature fact contains `node`, if any. */
export function signatureFactOf(node: AstNode): SigDecl | undefined {
    let child: AstNode = node;
    for (let current: AstNode | undefined = node.$container; current; child = current, current = current.$container) {
        if (isSigDecl(current)) return current.block === child ? current : undefined;
    }
    return undefined;
}

/** Whether `sig` is `ancestor` or reaches it through extends. */
export function extendsOrIs(sig: SigDecl, ancestor: SigDecl): boolean {
    const seen = new Set<SigDecl>();
    for (let current: SigDecl | undefined = sig; current && !seen.has(current); ) {
        if (current === ancestor) return true;
        seen.add(current);
        const parent: AstNode | undefined = current.extends?.ref?.ref;
        current = isSigName(parent) ? parent.$container : undefined;
    }
    return false;
}

/** Every combination of one relation from each column list, concatenated. */
function product(columns: RelationType[][]): RelationType[] {
    return columns.reduce<RelationType[]>((acc, column) => acc.flatMap(a => column.map(c => [...a, ...c])), [[]]);
}
