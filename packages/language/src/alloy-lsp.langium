grammar AlloyLsp

// Alloy 6, after the Analyzer's own parser: Alloy.cup (productions and
// precedence), Alloy.lex (tokens) and CompFilter.java (the token rewrites
// that sit between the two). Names are plain strings; resolving them is the
// job of scoping and linking.

entry Specification:
    (module=ModuleDecl | opens+=Open | paragraphs+=Paragraph)*;

// Everything a name in an expression, a sig reference or a command can
// denote. Alloy keeps one namespace for all of them per module.
type Referable =
    SigName | DeclName | ModuleParam | EnumDecl | EnumMember | FunDecl | PredDecl
    | AssertDecl | MacroDecl | MacroParam | LetBinding;

// ---------------------------------------------------------------- modules

ModuleDecl:
    'module' name=QualifiedName ('[' params+=ModuleParam (',' params+=ModuleParam)* ']')?;

ModuleParam:
    exactly?='exactly'? name=QualifiedName;

Open:
    private?='private'? 'open' path=QualifiedName
    ('[' (args+=SigRef (',' args+=SigRef)*)? ']')?
    ('as' alias=QualifiedName)?;

// ------------------------------------------------------------- paragraphs

Paragraph:
    SigDecl | EnumDecl | FactDecl | AssertDecl | FunDecl | PredDecl | MacroDecl | Command;

SigDecl:
    (abstract?='abstract' | multiplicity=('lone' | 'one' | 'some') | private?='private' | var?='var')*
    'sig' names+=SigName (',' names+=SigName)*
    ( 'extends' extends=SigRef
    | 'in' in+=SigRef ('+' in+=SigRef)*
    | '=' equals+=SigRef ('+' equals+=SigRef)*
    )?
    '{' ','* (fields+=Decl (','+ fields+=Decl)* ','*)? '}'
    block=Block?;

SigName:
    name=ID;

EnumDecl:
    private?='private'? 'enum' name=ID '{' (members+=EnumMember (',' members+=EnumMember)*)? '}';

EnumMember:
    name=ID;

FactDecl:
    'fact' (name=ID | label=STRING)? body=Block;

AssertDecl:
    'assert' (name=ID | label=STRING)? body=Block;

FunDecl:
    private?='private'? 'fun' (receiver=SigRef '.')? name=ID
    ('(' ParamList ')' | '[' ParamList ']')?
    ':' returnType=Expr body=Block;

PredDecl:
    private?='private'? 'pred' (receiver=SigRef '.')? name=ID
    ('(' ParamList ')' | '[' ParamList ']')?
    body=Block;

// Alloy accepts stray commas around parameter declarations.
fragment ParamList:
    ','* (params+=Decl (','+ params+=Decl)* ','*)?;

MacroDecl:
    private?='private'? 'let' name=ID
    ( '(' (params+=MacroParam (',' params+=MacroParam)*)? ')'
    | '[' (params+=MacroParam (',' params+=MacroParam)*)? ']'
    )?
    (body=Block | '=' value=Expr);

MacroParam:
    name=ID;

// One declaration of one or more names: a field, a parameter or a bound
// variable. '=' instead of ':' defines the names rather than bounding them.
Decl:
    var?='var'? private?='private'? disj?='disj'?
    names+=DeclName (',' names+=DeclName)*
    (':' | defines?='=') disjType?='disj'? type=Expr;

// The variables of a quantifier or comprehension always take ':'. CompFilter
// only makes a quantifier when names are followed by ':', so the Analyzer
// reads `some x = e` as a multiplicity test, and comprehensions use Declz.
BoundDecl infers Decl:
    var?='var'? private?='private'? disj?='disj'?
    names+=DeclName (',' names+=DeclName)*
    ':' disjType?='disj'? type=Expr;

DeclName:
    name=ID;

// --------------------------------------------------------------- commands

// `a: run p` is the Analyzer's labelled form; `=>` chains commands.
Command:
    (label=ID ':')? calls+=CommandCall ('=>' calls+=CommandCall)*;

// `run p`, `run lbl p`, `run {…}` and `run lbl {…}`: an optional label,
// then the predicate or assertion to run, or an inline block.
CommandCall:
    kind=('run' | 'check')
    name=QualifiedName? (body=Block | target=[Referable:QualifiedName])
    scope=Scope?
    ('expect' expect=NUMBER)?;

Scope:
    'for'
    ( overall=NUMBER ('but' typeScopes+=TypeScope (',' typeScopes+=TypeScope)*)?
    | typeScopes+=TypeScope (',' typeScopes+=TypeScope)*
    );

// `n`, `n..m`, open-ended `n..`, each optionally `:step`.
TypeScope:
    exactly?='exactly'? start=NUMBER (range?='.' '.' end=NUMBER?)? (':' increment=NUMBER)?
    (builtin=('Int' | 'int' | 'seq' | 'univ' | 'String' | 'steps' | 'none') | sig=[Referable:QualifiedName]);

// ------------------------------------------------------------ expressions
//
// Lowest precedence first, as in Alloy.cup. Quantifiers and `let` sit with
// the primary expressions: their bodies extend as far right as possible,
// which is how Alloy.cup lets them close any operator chain.

Expr:
    ExprNoSeq ({infer SequenceExpr.left=current} ';' right=Expr)?;

ExprNoSeq infers Expr:
    OrLevel;

OrLevel infers Expr:
    IffLevel ({infer BinaryExpr.left=current} op=('||' | 'or') right=IffLevel)*;

IffLevel infers Expr:
    ImpliesLevel ({infer BinaryExpr.left=current} op=('<=>' | 'iff') right=ImpliesLevel)*;

// Right-associative; an `else` belongs to the nearest `=>`.
ImpliesLevel infers Expr:
    AndLevel ({infer ImpliesExpr.condition=current} op=('=>' | 'implies') then=ImpliesLevel ('else' else=ImpliesLevel)?)?;

AndLevel infers Expr:
    TemporalBinaryLevel ({infer BinaryExpr.left=current} op=('&&' | 'and') right=TemporalBinaryLevel)*;

TemporalBinaryLevel infers Expr:
    UnaryFormulaLevel ({infer BinaryExpr.left=current} op=('until' | 'releases' | 'since' | 'triggered') right=UnaryFormulaLevel)*;

UnaryFormulaLevel infers Expr:
    {infer UnaryExpr} op=('!' | 'not' | 'always' | 'eventually' | 'after' | 'historically' | 'once' | 'before') operand=UnaryFormulaLevel
    | CompareLevel;

// The multiplicity alternative comes first: where `some x` could also
// start a quantifier (right after `x:`), Alloy reads a multiplicity.
CompareLevel infers Expr:
    (MultiplicityLevel | ShiftLevel) ({infer BinaryExpr.left=current} op=CompareOp right=ShiftLevel)*;

MultiplicityLevel infers Expr:
    {infer UnaryExpr} op=('no' | 'some' | 'lone' | 'one' | 'set' | 'seq') operand=ShiftLevel;

CompareOp returns string:
    ('!' | 'not')? ('in' | '=' | '<' | '>' | '=<' | '<=' | '>=');

ShiftLevel infers Expr:
    UnionLevel ({infer BinaryExpr.left=current} op=('<<' | '>>' | '>>>') right=UnionLevel)*;

UnionLevel infers Expr:
    MulLevel ({infer BinaryExpr.left=current} op=('+' | '-' | FUN_ADDSUB) right=MulLevel)*;

MulLevel infers Expr:
    NumUnaryLevel ({infer BinaryExpr.left=current} op=FUN_MULDIVREM right=NumUnaryLevel)*;

NumUnaryLevel infers Expr:
    {infer UnaryExpr} op=('#' | 'sum' | 'int') operand=NumUnaryLevel
    | OverrideLevel;

OverrideLevel infers Expr:
    IntersectLevel ({infer BinaryExpr.left=current} op='++' right=IntersectLevel)*;

IntersectLevel infers Expr:
    ArrowLevel ({infer BinaryExpr.left=current} op='&' right=ArrowLevel)*;

// Right-associative, with an optional multiplicity on each side.
ArrowLevel infers Expr:
    DomainLevel ({infer ArrowExpr.left=current} leftMult=ArrowMult? '->' rightMult=ArrowMult? right=ArrowLevel)?;

ArrowMult returns string:
    'some' | 'one' | 'lone' | 'set';

DomainLevel infers Expr:
    RangeLevel ({infer BinaryExpr.left=current} op='<:' right=RangeLevel)*;

RangeLevel infers Expr:
    JoinLevel ({infer BinaryExpr.left=current} op=':>' right=JoinLevel)*;

// Dot join and box join chain left to right: a.b[c] is (a.b)[c].
JoinLevel infers Expr:
    JoinHead
    ( {infer JoinExpr.left=current} ('.' | '::') right=JoinRight
    | {infer BoxJoinExpr.target=current} '[' (args+=Expr (',' args+=Expr)*)? ']'
    )*;

JoinHead infers Expr:
    {infer BuiltinCall} fn=BuiltinName '[' (args+=Expr (',' args+=Expr)*)? ']'
    | RelUnaryLevel;

JoinRight infers Expr:
    {infer BuiltinRef} fn=BuiltinName
    | RelUnaryLevel;

BuiltinName returns string:
    'disj' | PRED_TOTALORDER | 'int' | 'sum';

// The prime binds looser than ~ * ^: ~r' is (~r)'.
RelUnaryLevel infers Expr:
    RelPrefixLevel ({infer PrimeExpr.operand=current} ("'" | '‘' | '’'))*;

RelPrefixLevel infers Expr:
    {infer UnaryExpr} op=('~' | '*' | '^') operand=RelPrefixLevel
    | PrimaryExpr;

PrimaryExpr infers Expr:
    {infer NumberLiteral} negative?='-'? value=NUMBER
    | {infer StringLiteral} value=STRING
    | {infer ConstantExpr} value=('iden' | 'this' | FUN_CONST)
    | {infer BuiltinSigExpr} name=BuiltinSig
    | {infer NameExpr} ref=[Referable:QualifiedName]
    | {infer AtNameExpr} '@' ref=[Referable:QualifiedName]
    | '(' Expr ')'
    | Block
    | Comprehension
    | LetExpr
    | QuantifiedExpr;

Block:
    {infer Block} '{' exprs+=Expr* '}';

Comprehension:
    '{' decls+=BoundDecl (',' decls+=BoundDecl)* ('|' body=Expr | body=Block)? '}';

LetExpr:
    'let' bindings+=LetBinding (',' bindings+=LetBinding)* ('|' body=Expr | body=Block);

LetBinding:
    name=ID '=' value=Expr;

QuantifiedExpr:
    quantifier=('all' | 'no' | 'some' | 'lone' | 'one' | 'sum')
    decls+=BoundDecl (',' decls+=BoundDecl)*
    ('|' body=Expr | body=Block);

// ------------------------------------------------------------------ names

SigRef:
    builtin=BuiltinSig | ref=[Referable:QualifiedName];

// Sigs Alloy defines itself; they are keywords, not declarations.
BuiltinSig returns string:
    'univ' | 'String' | 'steps' | 'Int' | 'none' | 'seq' '/' 'Int';

QualifiedName returns string:
    ('this' '/' | 'seq' '/')? ID ('/' ID)*;

// ------------------------------------------------------------- terminals

hidden terminal WS: /\s+/;
hidden terminal ML_COMMENT: /\/\*[\s\S]*?\*\//;
hidden terminal SL_COMMENT: /(\/\/|--)[^\n\r]*/;

// The Analyzer reads these as single tokens. They win over the `fun` and
// `pred` keywords by being longer, and stop where an identifier would go on.
terminal FUN_ADDSUB: /fun\/(add|sub)(?![A-Za-z0-9_$"])/;
terminal FUN_MULDIVREM: /fun\/(mul|div|rem)(?![A-Za-z0-9_$"])/;
terminal FUN_CONST: /fun\/(min|max|next)(?![A-Za-z0-9_$"])/;
terminal PRED_TOTALORDER: /pred\/totalOrder(?![A-Za-z0-9_$"])/;

// Java letters and digits, plus `"` after the first character. The curly
// quotes U+2018/U+2019 are primes, not letters.
terminal ID: /[A-Za-z_$\u00C0-\u2017\u201A-\uFFFF][A-Za-z0-9_$"\u00C0-\u2017\u201A-\uFFFF]*/;
// Only hex and binary numbers take `_`: in Alloy.lex, 1_000 is "a name starting with a number".
terminal NUMBER returns number: /0x([_]|[0-9A-Fa-f][0-9A-Fa-f])+|0b[01_]+|[0-9]+/;
terminal STRING: /"(\\.|[^"\\])*"/;
