# cspell:ignore trigsimp powsimp powdenest nsimplify preorder
"""Writes the reference verdicts of `expression-equivalent` from SymPy.

Pairs of expressions, equations and solution sets, written by `sympy.latex` and again as MathLive writes them, with planted
wrong pairs. A pair's verdict is SymPy's on real symbols, positive or negative where a variable's range lies on one side of 0:
`simplify(a - b) == 0` for expressions, `simplify(r1 / r2)` a non-zero number for equations, `FiniteSet` equality of
simplified values for solution sets. A pair SymPy cannot decide (no `simplify` to 0, and no point where the sides differ at
30 digits) is left out and counted. It also writes the values of expressions at points, at 30 digits, which the reader and the
complex arithmetic must give.

Run from the repository root, in a venv from `validation/operators/requirements.txt`:

    python -I validation/operators/expressions.py packages/runtime/test/fixtures/operators-expressions.json

An expression whose value passes 1e250 at a point of its range is left out and counted too, as is a pair whose sides differ
by less than 1e-6 of their size at every point: the comparator evaluates in doubles, which overflow past 1e308 and cannot
tell such sides apart.
"""

import json
import platform
import random
import re
import sys

import mpmath
import sympy as sp

SEED = 20261104
DIGITS = 30
# Two sides that differ by less than this share of their size at every point are below what a comparator in doubles can
# tell apart (its bound is 1e-9, and rounding errors of cancelling terms reach it), so the pair is left out and counted.
RESOLUTION = 1e-6
DEFAULT_RANGE = (-10.0, 10.0)
RANGES = {"real": DEFAULT_RANGE, "positive": (0.5, 10.0), "negative": (-10.0, -0.5)}

rng = random.Random(SEED)


def symbols(domain):
    """The symbols x and y on a domain: real, positive or negative, as the key's ranges state."""
    assumptions = {"real": {"real": True}, "positive": {"positive": True}, "negative": {"negative": True}}[domain]
    return sp.Symbol("x", **assumptions), sp.Symbol("y", **assumptions)


def ranges_of(domain, names):
    """The `variables` of a key: none for the default range, else each variable's range."""
    if domain == "real":
        return {}
    low, high = RANGES[domain]
    return {name: {"min": low, "max": high} for name in names}


# The LaTeX of SymPy's printer, with natural logarithms as \ln and inverse trigonometry as \arcsin.
def sympy_latex(expression):
    return sp.latex(expression, ln_notation=True, inv_trig_style="full")


FUNCTIONS = {
    sp.sin: r"\sin",
    sp.cos: r"\cos",
    sp.tan: r"\tan",
    sp.sec: r"\sec",
    sp.csc: r"\csc",
    sp.cot: r"\cot",
    sp.asin: r"\arcsin",
    sp.acos: r"\arccos",
    sp.atan: r"\arctan",
    sp.sinh: r"\sinh",
    sp.cosh: r"\cosh",
    sp.tanh: r"\tanh",
    sp.log: r"\ln",
}


def mathlive_number(value, comma):
    text = str(value)
    return text.replace(".", "{,}") if comma else text


def mathlive(expression, comma=False):
    """The LaTeX that MathLive writes for an expression: \\frac12, \\left( \\right), \\exponentialE, {,} as the mark."""
    e = expression
    if e is sp.pi:
        return r"\pi"
    if e is sp.E:
        return r"\exponentialE"
    if e.is_Integer:
        return str(e)
    if e.is_Rational:
        p, q = abs(e.p), e.q
        body = rf"\frac{p}{q}" if p < 10 and q < 10 else rf"\frac{{{p}}}{{{q}}}"
        return ("-" if e.p < 0 else "") + body
    if e.is_Float:
        return mathlive_number(e, comma)
    if e.is_Symbol:
        return e.name
    if e.is_Add:
        return mathlive_sum(e, comma)
    if e.is_Mul:
        return mathlive_product(e, comma)
    if e.is_Pow:
        return mathlive_power(e, comma)
    if isinstance(e, sp.exp):
        return rf"\exponentialE^{{{mathlive(e.args[0], comma)}}}"
    if isinstance(e, sp.Abs):
        return rf"\left|{mathlive(e.args[0], comma)}\right|"
    for function, name in FUNCTIONS.items():
        if isinstance(e, function):
            return rf"{name}\left({mathlive(e.args[0], comma)}\right)"
    raise ValueError(f"No MathLive form for {e!r}")


def mathlive_sum(e, comma):
    parts = []
    for index, term in enumerate(e.as_ordered_terms()):
        negative = term.could_extract_minus_sign()
        text = mathlive(-term if negative else term, comma)
        parts.append(("-" if negative else ("" if index == 0 else "+")) + text)
    return "".join(parts)


def grouped(e, comma):
    text = mathlive(e, comma)
    return rf"\left({text}\right)" if (e.is_Add or (e.is_Number and e < 0)) else text


def mathlive_product(e, comma):
    if e.could_extract_minus_sign():
        return "-" + grouped(-e, comma) if (-e).is_Add else "-" + mathlive(-e, comma)
    numerator, denominator = sp.fraction(e)
    if denominator != 1:
        return rf"\frac{{{mathlive(numerator, comma)}}}{{{mathlive(denominator, comma)}}}"
    factors = e.as_ordered_factors()
    text = ""
    for index, factor in enumerate(factors):
        part = grouped(factor, comma)
        if index > 0 and (part[0].isdigit() or (factors[index - 1].is_Number and factor.is_Number)):
            text += r"\cdot"
        elif re.search(r"\\[A-Za-z]+$", text) and part[0].isalpha():
            text += " "
        text += part
    return text


def mathlive_power(e, comma):
    base, exponent = e.args
    if exponent == sp.Rational(1, 2):
        return rf"\sqrt{{{mathlive(base, comma)}}}"
    if exponent == -1:
        return rf"\frac{{1}}{{{mathlive(base, comma)}}}"
    if exponent.is_Rational and exponent.p == 1 and exponent.q > 2:
        return rf"\sqrt[{exponent.q}]{{{mathlive(base, comma)}}}"
    base_text = mathlive(base, comma)
    if not (base.is_Symbol or (base.is_Integer and base > 0) or base in (sp.pi, sp.E)):
        base_text = rf"\left({base_text}\right)"
    exponent_text = mathlive(exponent, comma)
    if exponent.is_Integer and 0 <= exponent < 10:
        return f"{base_text}^{exponent_text}"
    return f"{base_text}^{{{exponent_text}}}"


def atom(x, y, two):
    choice = rng.random()
    if choice < 0.45:
        return x
    if choice < 0.6 and two:
        return y
    if choice < 0.85:
        return sp.Integer(rng.choice([1, 2, 3, 4, 5, 6, 7, 9]))
    if choice < 0.95:
        return sp.Rational(rng.choice([1, 2, 3]), rng.choice([2, 3, 4]))
    return sp.pi


UNARY = [sp.sin, sp.cos, sp.tan, sp.exp, sp.log, sp.sqrt, sp.Abs, sp.atan, sp.sinh, sp.cosh, sp.tanh, sp.sec]


def generate(depth, x, y, two):
    if depth == 0:
        return atom(x, y, two)
    kind = rng.random()
    if kind < 0.3:
        return generate(depth - 1, x, y, two) + generate(depth - 1, x, y, two)
    if kind < 0.55:
        return generate(depth - 1, x, y, two) * generate(depth - 1, x, y, two)
    if kind < 0.68:
        return generate(depth - 1, x, y, two) / (generate(depth - 1, x, y, two) + rng.choice([1, 2, 3]))
    if kind < 0.8:
        return generate(depth - 1, x, y, two) ** rng.choice([2, 3, -1, sp.Rational(1, 2), sp.Rational(1, 3)])
    if kind < 0.95:
        return rng.choice(UNARY)(generate(depth - 1, x, y, two))
    return atom(x, y, two)


def equivalents(e, x):
    """Forms that SymPy rewrites an expression to, which may or may not keep its value: the verdict is SymPy's."""
    rewrites = [
        sp.expand,
        sp.factor,
        sp.together,
        sp.cancel,
        sp.trigsimp,
        sp.expand_trig,
        sp.powsimp,
        lambda value: sp.expand_log(value, force=True),
        lambda value: sp.powdenest(value, force=True),
        lambda value: value.rewrite(sp.exp) if value.has(sp.sinh, sp.cosh, sp.tanh) else value * (x + 2) / (x + 2),
        lambda value: value + sp.sin(x) ** 2 + sp.cos(x) ** 2 - 1,
    ]
    return rng.choice(rewrites)(e)


def wrong(e, x):
    plants = [
        lambda value: value + 1,
        lambda value: 2 * value,
        lambda value: value.subs(x, x + 1),
        lambda value: value - x,
        lambda value: value.replace(sp.sin, sp.cos) if value.has(sp.sin) else value + sp.Rational(1, 2),
        lambda value: -value,
    ]
    return rng.choice(plants)(e)


def point_values(e, names, domain, count):
    """Points in the ranges, written with 6 decimals, and the expression's value there at 30 digits, where finite."""
    low, high = RANGES[domain]
    found = []
    syms = {symbol.name: symbol for symbol in e.free_symbols}
    for _ in range(count):
        point = {name: round(rng.uniform(low, high), 6) for name in names}
        value = sp.N(e.subs({syms[name]: sp.Float(str(point[name]), DIGITS) for name in names if name in syms}), DIGITS)
        if value.has(sp.zoo, sp.nan, sp.oo, -sp.oo) or not value.is_number:
            continue
        re, im = (float(part) for part in value.as_real_imag())
        if all(map(lambda part: abs(part) < 1e300, (re, im))):
            found.append({"point": point, "value": [re, im]})
    return found


def differs(a, b, names, domain):
    """Whether two expressions differ at some point of the ranges, at 30 digits: a finite point where they are apart."""
    syms = {symbol.name: symbol for symbol in a.free_symbols | b.free_symbols}
    low, high = RANGES[domain]
    for _ in range(30):
        point = {syms[name]: sp.Float(str(round(rng.uniform(low, high), 6)), DIGITS) for name in names if name in syms}
        left, right = sp.N(a.subs(point), DIGITS), sp.N(b.subs(point), DIGITS)
        if any(value.has(sp.zoo, sp.nan, sp.oo, -sp.oo) or not value.is_number for value in (left, right)):
            continue
        if abs(complex(left) - complex(right)) > RESOLUTION * max(1.0, abs(complex(left)), abs(complex(right))):
            return True
    return False


def finite_in_doubles(e, names, domain):
    """Whether every part of an expression stays within double range at points of its ranges, as the comparator needs."""
    syms = {symbol.name: symbol for symbol in e.free_symbols}
    low, high = RANGES[domain]
    points = [{syms[name]: sp.Float(str(round(rng.uniform(low, high), 6)), DIGITS) for name in names if name in syms} for _ in range(5)]
    for part in sp.preorder_traversal(e):
        if not isinstance(part, sp.Expr) or part.is_Atom:
            continue
        for point in points:
            value = sp.N(part.subs(point), DIGITS)
            if value.is_number and not value.has(sp.zoo, sp.nan) and abs(complex(value)) > 1e250:
                return False
    return True


def beyond_doubles(expressions, names, domain):
    """Whether an expression passes 1e250 at one of 8 points of its range, where doubles overflow."""
    low, high = RANGES[domain]
    for _ in range(8):
        for e in expressions:
            syms = {symbol.name: symbol for symbol in e.free_symbols}
            point = {syms[name]: sp.Float(str(round(rng.uniform(low, high), 6)), DIGITS) for name in names if name in syms}
            value = sp.N(e.subs(point), DIGITS)
            if value.has(sp.oo, -sp.oo):
                return True
            if value.is_number and not value.has(sp.zoo, sp.nan) and abs(complex(value)) > 1e250:
                return True
    return False


def verdict_of_expressions(a, b, names, domain):
    if sp.simplify(a - b) == 0:
        return True
    return False if differs(a, b, names, domain) else None


def render(e, style, comma=False):
    return sympy_latex(e) if style == "sympy" else mathlive(e, comma)


SPECIAL = [
    # Branches and domains: the comparator's complex arithmetic must take SymPy's side on real symbols. The forms are left
    # unevaluated, so that SymPy's constructor does not simplify them away.
    ("real", lambda x, y: sp.Mul(sp.sqrt(x), sp.sqrt(x), evaluate=False), lambda x, y: x),
    ("real", lambda x, y: sp.log(x**2), lambda x, y: 2 * sp.log(x)),
    ("positive", lambda x, y: sp.log(x**2), lambda x, y: 2 * sp.log(x)),
    ("real", lambda x, y: sp.Pow(x**2, sp.Rational(1, 2), evaluate=False), lambda x, y: x),
    ("positive", lambda x, y: sp.Pow(x**2, sp.Rational(1, 2), evaluate=False), lambda x, y: x),
    ("real", lambda x, y: sp.Pow(x**2, sp.Rational(1, 2), evaluate=False), lambda x, y: sp.Abs(x)),
    ("real", lambda x, y: (x**2 - 1) / (x - 1), lambda x, y: x + 1),
    ("real", lambda x, y: sp.Pow(sp.root(x, 3), 3, evaluate=False), lambda x, y: x),
    ("real", lambda x, y: sp.Pow(x**3, sp.Rational(1, 3), evaluate=False), lambda x, y: x),
    ("positive", lambda x, y: sp.Pow(x**3, sp.Rational(1, 3), evaluate=False), lambda x, y: x),
    ("real", lambda x, y: sp.exp(sp.log(x), evaluate=False), lambda x, y: x),
    ("real", lambda x, y: sp.log(sp.exp(x), evaluate=False), lambda x, y: x),
    ("real", lambda x, y: sp.atan(x) + sp.atan(1 / x), lambda x, y: sp.pi / 2),
    ("real", lambda x, y: sp.sin(x) ** 2 + sp.cos(x) ** 2, lambda x, y: sp.Integer(1)),
    ("real", lambda x, y: sp.tan(x), lambda x, y: sp.sin(x) / sp.cos(x)),
    ("real", lambda x, y: sp.sec(x), lambda x, y: 1 / sp.cos(x)),
    ("real", lambda x, y: sp.cosh(x) ** 2 - sp.sinh(x) ** 2, lambda x, y: sp.Integer(1)),
    ("real", lambda x, y: (x + y) ** 2, lambda x, y: x**2 + 2 * x * y + y**2),
    ("real", lambda x, y: (x + y) ** 2, lambda x, y: x**2 + y**2),
    ("real", lambda x, y: sp.sqrt(x) * sp.sqrt(y), lambda x, y: sp.sqrt(x * y)),
    ("positive", lambda x, y: sp.Mul(sp.sqrt(x), sp.sqrt(y), evaluate=False), lambda x, y: sp.sqrt(x * y)),
    ("negative", lambda x, y: sp.Mul(sp.sqrt(x), sp.sqrt(y), evaluate=False), lambda x, y: sp.sqrt(x * y)),
    ("real", lambda x, y: sp.asin(x / 3) + sp.asin(-x / 3), lambda x, y: sp.Integer(0)),
    ("real", lambda x, y: sp.atan(sp.sqrt(x)) + 1, lambda x, y: sp.atan(sp.sqrt(x))),
    ("real", lambda x, y: sp.log(x, 10), lambda x, y: sp.log(x) / sp.log(10)),
    ("real", lambda x, y: sp.Abs(x) / x, lambda x, y: sp.Integer(1)),
    ("positive", lambda x, y: sp.Abs(x) / x, lambda x, y: sp.Integer(1)),
]

# Forms that the reader must give the meaning of: the LaTeX of the key and of the response, and the SymPy expression each
# means, from which SymPy's verdict comes.
RAW = [
    (r"x^{\left(\frac12\right)}", r"\sqrt{x}", lambda x: x ** sp.Rational(1, 2), lambda x: sp.sqrt(x)),
    (r"\left(x-9\right)^{\left(\frac13\right)}", r"\sqrt[3]{x-9}", lambda x: (x - 9) ** sp.Rational(1, 3), lambda x: sp.root(x - 9, 3)),
    (r"\left(-8\right)^{\frac13}x", r"-2x", lambda x: sp.Integer(-8) ** sp.Rational(1, 3) * x, lambda x: -2 * x),
    (r"\sin^{-1}x", r"\arcsin\left(x\right)", lambda x: sp.asin(x), lambda x: sp.asin(x)),
    (r"\sin^{-1}x", r"\frac{1}{\sin x}", lambda x: sp.asin(x), lambda x: 1 / sp.sin(x)),
    (r"\sec^{-1}x", r"\cos x", lambda x: 1 / sp.sec(x), lambda x: sp.cos(x)),
    (r"\log x", r"\frac{\ln x}{\ln 10}", lambda x: sp.log(x, 10), lambda x: sp.log(x) / sp.log(10)),
    (r"\log x", r"\ln x", lambda x: sp.log(x, 10), lambda x: sp.log(x)),
    (r"\lg x", r"\log_{10}x", lambda x: sp.log(x, 10), lambda x: sp.log(x, 10)),
    (r"\operatorname{lb}\left(x\right)", r"\log_2 x", lambda x: sp.log(x, 2), lambda x: sp.log(x, 2)),
    (r"\operatorname{sin}x", r"\sin x", lambda x: sp.sin(x), lambda x: sp.sin(x)),
    (r"\mathrm{abs}\left(x-1\right)", r"\left|x-1\right|", lambda x: sp.Abs(x - 1), lambda x: sp.Abs(x - 1)),
    (r"abs\left(x\right)", r"\lvert x\rvert", lambda x: sp.Abs(x), lambda x: sp.Abs(x)),
    (r"sin(x)+sqrt(x)", r"\sin x+\sqrt{x}", lambda x: sp.sin(x) + sp.sqrt(x), lambda x: sp.sin(x) + sp.sqrt(x)),
    (r"30^\circ x", r"\frac{\pi}{6}x", lambda x: sp.pi / 6 * x, lambda x: sp.pi / 6 * x),
    (r"x\degree", r"\frac{\pi x}{180}", lambda x: sp.pi * x / 180, lambda x: sp.pi * x / 180),
    (r"50\%x", r"\frac12x", lambda x: x / 2, lambda x: x / 2),
    (r"\exponentialE^{x}", r"\exp\left(x\right)", lambda x: sp.exp(x), lambda x: sp.exp(x)),
    (r"\mathrm{e}^x", r"e^{x}", lambda x: sp.exp(x), lambda x: sp.exp(x)),
    (r"\frac34x", r"0.75x", lambda x: sp.Rational(3, 4) * x, lambda x: sp.Rational(3, 4) * x),
    (r"2\frac{1}{2}x", r"x", lambda x: x, lambda x: x),
    (r"1.5e3x", r"1500x", lambda x: sp.Rational(3, 2) * sp.E * 3 * x, lambda x: 1500 * x),
    (r"1.5\times10^{3}x", r"1500x", lambda x: 1500 * x, lambda x: 1500 * x),
    (r"\tan\left(x\right)^2", r"\tan^2x", lambda x: sp.tan(x) ** 2, lambda x: sp.tan(x) ** 2),
    (r"\tan\left(x\right)^2", r"\tan\left(x^2\right)", lambda x: sp.tan(x) ** 2, lambda x: sp.tan(x**2)),
    (r"\sin x\cos x", r"\frac{\sin 2x}{2}", lambda x: sp.sin(x) * sp.cos(x), lambda x: sp.sin(2 * x) / 2),
    (r"\sin\frac{\pi}{6}x", r"\sin\left(\frac{\pi x}{6}\right)", lambda x: sp.sin(sp.pi * x / 6), lambda x: sp.sin(sp.pi * x / 6)),
    (r"\sin x^2", r"\sin\left(x^2\right)", lambda x: sp.sin(x**2), lambda x: sp.sin(x**2)),
    (r"\ln 2x", r"\ln2+\ln x", lambda x: sp.log(2 * x), lambda x: sp.log(2) + sp.log(x)),
    (r"x^23", r"3x^2", lambda x: 3 * x**2, lambda x: 3 * x**2),
    (r"\frac{x}{2}\cdot\frac{4}{x}", r"2", lambda x: sp.Integer(2), lambda x: sp.Integer(2)),
    (r"6\div 3x", r"2x", lambda x: 2 * x, lambda x: 2 * x),
    (r"\left[x+1\right]^2", r"\left(x+1\right)^{2}", lambda x: (x + 1) ** 2, lambda x: (x + 1) ** 2),
    (r"\lbrack x+1\rbrack", r"x+1", lambda x: x + 1, lambda x: x + 1),
    (r"||x|-2|", r"\left|\left|x\right|-2\right|", lambda x: sp.Abs(sp.Abs(x) - 2), lambda x: sp.Abs(sp.Abs(x) - 2)),
    (r"--x", r"x", lambda x: x, lambda x: x),
    (r"x\cdot-3", r"-3x", lambda x: -3 * x, lambda x: -3 * x),
    (r"\cfrac{1}{x}+\dfrac{1}{x}", r"\tfrac{2}{x}", lambda x: 2 / x, lambda x: 2 / x),
    (r"\sqrt[3]{x^3}", r"x", lambda x: sp.Pow(x**3, sp.Rational(1, 3), evaluate=False), lambda x: x),
    (r"\sqrt2x", r"\sqrt{2}x", lambda x: sp.sqrt(2) * x, lambda x: sp.sqrt(2) * x),
    (r"x_12", r"2x_1", lambda x: 2 * sp.Symbol("x_1", real=True), lambda x: 2 * sp.Symbol("x_1", real=True)),
    (r"x_{12}+x_1", r"x_1+x_{12}", lambda x: sp.Symbol("x_12", real=True) + sp.Symbol("x_1", real=True), lambda x: sp.Symbol("x_1", real=True) + sp.Symbol("x_12", real=True)),
    (r"\alpha+\beta", r"\beta+\alpha", lambda x: sp.Symbol("alpha", real=True) + sp.Symbol("beta", real=True), lambda x: sp.Symbol("alpha", real=True) + sp.Symbol("beta", real=True)),
    (r"2x", r"2y", lambda x: 2 * x, lambda x: 2 * sp.Symbol("y", real=True)),
    (r"x\cdot e", r"ex", lambda x: sp.E * x, lambda x: sp.E * x),
    (r"\pi r^2", r"\pi\cdot r^2", lambda x: sp.pi * sp.Symbol("r", real=True) ** 2, lambda x: sp.pi * sp.Symbol("r", real=True) ** 2),
    (r"\cosh\left(\ln x\right)", r"\frac{x^2+1}{2x}", lambda x: sp.cosh(sp.log(x)), lambda x: (x**2 + 1) / (2 * x)),
]


def raw_cases():
    cases, undecided = [], 0
    x, _ = symbols("real")
    for key, response, left, right in RAW:
        a, b = left(x), right(x)
        names = sorted(symbol.name for symbol in (a.free_symbols | b.free_symbols))
        verdict = verdict_of_expressions(a, b, names, "real")
        if verdict is None:
            undecided += 1
            continue
        cases.append(case("expression", key, response, {}, ".", verdict, "raw"))
    return cases, undecided


def expression_cases(count, two_variables):
    cases, undecided = [], 0
    while len(cases) < count:
        domain = rng.choice(["real", "real", "positive", "negative"])
        x, y = symbols(domain)
        names = ["x", "y"] if two_variables else ["x"]
        a = generate(rng.choice([2, 3]), x, y, two_variables)
        if not a.free_symbols or a.has(sp.zoo, sp.nan, sp.oo, sp.I):
            continue
        b = equivalents(a, x) if rng.random() < 0.55 else wrong(a, x)
        if b.has(sp.zoo, sp.nan, sp.oo, sp.I) or sp.count_ops(a) > 25 or sp.count_ops(b) > 40:
            continue
        if not (finite_in_doubles(a, names, domain) and finite_in_doubles(b, names, domain)):
            continue
        if beyond_doubles([a, b], names, domain):
            undecided += 1
            continue
        verdict = verdict_of_expressions(a, b, names, domain)
        if verdict is None:
            undecided += 1
            continue
        style = rng.choice(["sympy", "mathlive"])
        try:
            key, response = render(a, style), render(b, rng.choice(["sympy", "mathlive"]))
            if key == response:
                response = render(b, "mathlive" if style == "sympy" else "sympy")
        except ValueError:
            continue
        cases.append(case("expression", key, response, ranges_of(domain, names), ".", verdict, style))
    return cases, undecided


def case(form, key, response, variables, separator, equivalent, style):
    return {
        "form": form,
        "key": key,
        "response": response,
        "variables": variables,
        "decimalSeparator": separator,
        "equivalent": equivalent,
        "style": style,
    }


def special_cases():
    cases, undecided = [], 0
    for domain, left, right in SPECIAL:
        x, y = symbols(domain)
        a, b = left(x, y), right(x, y)
        names = sorted(symbol.name for symbol in (a.free_symbols | b.free_symbols))
        verdict = verdict_of_expressions(a, b, names, domain)
        if verdict is None:
            undecided += 1
            continue
        for style in ("sympy", "mathlive"):
            cases.append(case("expression", render(a, style), render(b, style), ranges_of(domain, names), ".", verdict, style))
    return cases, undecided


def comma_cases(count):
    """Pairs with decimals, as MathLive writes them with the decimal separator ","."""
    cases = []
    x, _ = symbols("real")
    for _ in range(count):
        whole, tenth, constant = rng.randint(1, 9), rng.randint(1, 9), rng.randint(1, 9)
        value = sp.Rational(10 * whole + tenth, 10)
        key = f"{whole}{{,}}{tenth}x+{constant}"
        forms = [
            (f"{constant}+{whole}{{,}}{tenth}x", value * x + constant),
            (rf"{whole}{{,}}{tenth}\cdot x+{constant}", value * x + constant),
            (rf"\frac{{{10 * whole + tenth}}}{{10}}x+{constant}", value * x + constant),
            (f"{whole}{{,}}{tenth}x+{constant}{{,}}1", value * x + constant + sp.Rational(1, 10)),
            (f"{whole}x+{constant}", whole * x + constant),
        ]
        response, meaning = rng.choice(forms)
        verdict = verdict_of_expressions(value * x + constant, meaning, ["x"], "real")
        cases.append(case("expression", key, response, {}, ",", verdict, "mathlive"))
    return cases


def linear_or_quadratic(x):
    a, b, c = rng.randint(1, 5), rng.randint(-6, 6), rng.randint(-6, 6)
    return a * x + b if rng.random() < 0.6 else a * x**2 + b * x + c


def equation_cases(count):
    cases, undecided = [], 0
    while len(cases) < count:
        domain = rng.choice(["real", "positive"])
        x, _ = symbols(domain)
        left, right = linear_or_quadratic(x), sp.Integer(rng.randint(-9, 9))
        if sp.simplify(left - right) == 0:
            continue
        k = rng.choice([2, -3, sp.Rational(1, 2), -1])
        t = linear_or_quadratic(x)
        if rng.random() < 0.6:
            other = rng.choice([(k * left, k * right), (left - right, sp.Integer(0)), (left + t, right + t), (right, left)])
        else:
            other = rng.choice([(left, right + 1), (left, 2 * right + 1), (left + x, right), (left**2, right)])
        ratio = sp.simplify((other[0] - other[1]) / (left - right))
        verdict = bool(ratio.is_number and ratio != 0 and ratio.is_finite)
        if not verdict and not differs(other[0] - other[1], k * (left - right), ["x"], domain):
            undecided += 1
            continue
        style = rng.choice(["sympy", "mathlive"])
        key = f"{render(left, style)}={render(right, style)}"
        response = f"{render(other[0], style)}={render(other[1], style)}"
        cases.append(case("equation", key, response, ranges_of(domain, ["x"]), ".", verdict, style))
    return cases, undecided


def written_set(values, style, braces, named):
    texts = [render(value, style) for value in values]
    if named:
        return r" \lor ".join(f"x={text}" for text in texts)
    joined = ",".join(texts)
    return rf"\{{{joined}\}}" if braces else joined


def solution_set_cases(count):
    cases = []
    x, _ = symbols("real")
    pools = [
        lambda: [sp.Integer(rng.randint(-9, 9)) for _ in range(rng.choice([1, 2, 3]))],
        lambda: [sp.Rational(rng.randint(-9, 9), rng.choice([2, 3, 4])), sp.Integer(rng.randint(-5, 5))],
        lambda: (lambda k: [sp.sqrt(k), -sp.sqrt(k)])(rng.choice([2, 3, 5, 7])),
    ]
    while len(cases) < count:
        roots = sorted(set(rng.choice(pools)()), key=float)
        equation = sp.expand(sp.Mul(*[(x - root) for root in roots]))
        key_values = sorted(sp.solveset(equation, x, sp.S.Reals), key=float)
        response = list(key_values)
        change = rng.random()
        if change < 0.25 and len(response) > 1:
            response.pop(rng.randrange(len(response)))
        elif change < 0.4:
            response.append(sp.Integer(rng.randint(10, 20)))
        elif change < 0.5:
            response[0] = response[0] + 1
        elif change < 0.65:
            response.append(response[0])
        rng.shuffle(response)
        verdict = sp.FiniteSet(*[sp.nsimplify(value) for value in response]) == sp.FiniteSet(*key_values)
        style = rng.choice(["sympy", "mathlive"])
        key_text = written_set(key_values, style, rng.random() < 0.4, rng.random() < 0.3)
        response_text = written_set(response, style, rng.random() < 0.4, rng.random() < 0.3)
        if len(key_values) == 2 and key_values[0] == -key_values[1] and rng.random() < 0.5:
            response_text = rf"x=\pm {render(abs(key_values[0]), style)}"
            verdict = sp.FiniteSet(*key_values) == sp.FiniteSet(abs(key_values[0]), -abs(key_values[0]))
        cases.append(case("solution-set", key_text, response_text, {}, ".", bool(verdict), style))
    return cases


def value_cases(expressions_count):
    cases = []
    while len(cases) < expressions_count:
        domain = rng.choice(["real", "real", "positive", "negative"])
        x, y = symbols(domain)
        two = rng.random() < 0.4
        e = generate(rng.choice([2, 3, 4]), x, y, two)
        if not e.free_symbols or e.has(sp.zoo, sp.nan, sp.oo, sp.I) or sp.count_ops(e) > 30:
            continue
        names = sorted(symbol.name for symbol in e.free_symbols)
        style = rng.choice(["sympy", "mathlive"])
        try:
            latex = render(e, style)
        except ValueError:
            continue
        points = point_values(e, names, domain, 3)
        if points:
            cases.append({"latex": latex, "style": style, "decimalSeparator": ".", "points": points})
    for domain, left, right in SPECIAL:
        x, y = symbols(domain)
        for e in (left(x, y), right(x, y)):
            names = sorted(symbol.name for symbol in e.free_symbols)
            points = point_values(e, names, "real", 3) if names else []
            if points:
                cases.append({"latex": sympy_latex(e), "style": "sympy", "decimalSeparator": ".", "points": points})
    return cases


def main(path):
    special, undecided_special = special_cases()
    raw, undecided_raw = raw_cases()
    one, undecided_one = expression_cases(240, False)
    two, undecided_two = expression_cases(120, True)
    equations, undecided_equations = equation_cases(120)
    fixture = {
        "generator": "validation/operators/expressions.py",
        "seed": SEED,
        "python": platform.python_version(),
        "sympy": sp.__version__,
        "mpmath": mpmath.__version__,
        "undecided": {
            "expressions": undecided_special + undecided_raw + undecided_one + undecided_two,
            "equations": undecided_equations,
        },
        "cases": special + raw + one + two + comma_cases(30) + equations + solution_set_cases(120),
        "values": value_cases(200),
    }
    with open(path, "w", encoding="utf-8") as file:
        json.dump(fixture, file, indent=1, ensure_ascii=False)
        file.write("\n")


if __name__ == "__main__":
    main(sys.argv[1])
