/** A complex number. The comparator evaluates at real points, and a real point can lead off the real line, as `\sqrt{-2}` does. */
export interface Complex {
  readonly re: number;
  readonly im: number;
}

/** Returns the complex number `re + im·i`. */
export function complex(re: number, im = 0): Complex {
  return { re, im };
}

const ONE = complex(1);
const HALF_PI = Math.PI / 2;

/** Whether both parts are finite: a pole, an overflow or an undefined value makes a point unusable. */
export function isFiniteComplex(z: Complex): boolean {
  return Number.isFinite(z.re) && Number.isFinite(z.im);
}

/** Whether a number lies on the real line. A part of -0 is on it too, and takes the side of +0, as an exact real does in SymPy. */
function isReal(z: Complex): boolean {
  return z.im === 0;
}

export function add(a: Complex, b: Complex): Complex {
  return complex(a.re + b.re, a.im + b.im);
}

export function subtract(a: Complex, b: Complex): Complex {
  return complex(a.re - b.re, a.im - b.im);
}

export function negate(a: Complex): Complex {
  return complex(-a.re, -a.im);
}

export function multiply(a: Complex, b: Complex): Complex {
  if (isReal(a) && isReal(b)) return complex(a.re * b.re);
  return complex(a.re * b.re - a.im * b.im, a.re * b.im + a.im * b.re);
}

/** Divides by Smith's algorithm, which does not overflow where the plain formula would. */
export function divide(a: Complex, b: Complex): Complex {
  if (isReal(a) && isReal(b)) return complex(a.re / b.re);
  const { re: c, im: d } = b;
  if (Math.abs(c) >= Math.abs(d)) {
    const ratio = d / c;
    const denominator = c + d * ratio;
    return complex((a.re + a.im * ratio) / denominator, (a.im - a.re * ratio) / denominator);
  }
  const ratio = c / d;
  const denominator = c * ratio + d;
  return complex((a.re * ratio + a.im) / denominator, (a.im * ratio - a.re) / denominator);
}

/** The modulus, a real number. */
export function abs(a: Complex): Complex {
  return complex(Math.hypot(a.re, a.im));
}

export function exp(a: Complex): Complex {
  const magnitude = Math.exp(a.re);
  return isReal(a) ? complex(magnitude) : complex(magnitude * Math.cos(a.im), magnitude * Math.sin(a.im));
}

/** The principal logarithm, its imaginary part in (-π, π]: the log of a negative real is ln|x| + iπ, as in SymPy. */
export function log(a: Complex): Complex {
  if (isReal(a)) return a.re < 0 ? complex(Math.log(-a.re), Math.PI) : complex(Math.log(a.re));
  return complex(Math.log(Math.hypot(a.re, a.im)), Math.atan2(a.im, a.re));
}

/** The principal square root: the root of a negative real is i·√|x|, as in SymPy. */
export function sqrt(a: Complex): Complex {
  const { re, im } = a;
  if (isReal(a)) return re < 0 ? complex(0, Math.sqrt(-re)) : complex(Math.sqrt(re));
  const half = Math.sqrt((Math.hypot(re, im) + Math.abs(re)) / 2);
  return re >= 0 ? complex(half, im / (2 * half)) : complex(Math.abs(im) / (2 * half), Math.sign(im) * half);
}

/** The largest integer exponent that is raised by repeated squaring; past it the power overflows or vanishes anyway. */
const SQUARING_LIMIT = 2 ** 53;

/** A complex number to an integer power, by repeated squaring, so that `(\sqrt{-3})^2` is -3 exactly, as in SymPy. */
function integerPower(base: Complex, exponent: number): Complex {
  let result = ONE;
  let square = exponent < 0 ? divide(ONE, base) : base;
  for (let rest = Math.abs(exponent); rest >= 1; rest = Math.floor(rest / 2)) {
    if (rest % 2 === 1) result = multiply(result, square);
    square = multiply(square, square);
  }
  return result;
}

/**
 * The principal power `a^b = exp(b·log a)`, as SymPy's `Pow`: a real to an integer power stays real, `0^0` is 1, and `0` to a
 * power whose real part is not above 0 is undefined.
 */
export function power(a: Complex, b: Complex): Complex {
  if (isReal(b) && Number.isInteger(b.re) && Math.abs(b.re) <= SQUARING_LIMIT) {
    return isReal(a) ? complex(a.re ** b.re) : integerPower(a, b.re);
  }
  if (a.re === 0 && a.im === 0) return b.re > 0 ? complex(0) : complex(Number.NaN, Number.NaN);
  if (isReal(a) && isReal(b) && a.re > 0) return complex(a.re ** b.re);
  return exp(multiply(b, log(a)));
}

export function sin(a: Complex): Complex {
  if (isReal(a)) return complex(Math.sin(a.re));
  return complex(Math.sin(a.re) * Math.cosh(a.im), Math.cos(a.re) * Math.sinh(a.im));
}

export function cos(a: Complex): Complex {
  if (isReal(a)) return complex(Math.cos(a.re));
  return complex(Math.cos(a.re) * Math.cosh(a.im), -Math.sin(a.re) * Math.sinh(a.im));
}

export function tan(a: Complex): Complex {
  return isReal(a) ? complex(Math.tan(a.re)) : divide(sin(a), cos(a));
}

export function sinh(a: Complex): Complex {
  if (isReal(a)) return complex(Math.sinh(a.re));
  return complex(Math.sinh(a.re) * Math.cos(a.im), Math.cosh(a.re) * Math.sin(a.im));
}

export function cosh(a: Complex): Complex {
  if (isReal(a)) return complex(Math.cosh(a.re));
  return complex(Math.cosh(a.re) * Math.cos(a.im), Math.sinh(a.re) * Math.sin(a.im));
}

export function tanh(a: Complex): Complex {
  return isReal(a) ? complex(Math.tanh(a.re)) : divide(sinh(a), cosh(a));
}

const I = complex(0, 1);

/**
 * The principal arcsine. Off the real line it is `-i·log(i·z + √(1 − z²))`; on the cuts, a real beyond ±1, it takes the
 * side SymPy takes: `asin(2)` is π/2 − 1.317i, and `asin(-2)` its negative.
 */
export function asin(a: Complex): Complex {
  if (isReal(a)) {
    if (Math.abs(a.re) <= 1) return complex(Math.asin(a.re));
    return a.re > 1 ? complex(HALF_PI, -Math.acosh(a.re)) : complex(-HALF_PI, Math.acosh(-a.re));
  }
  return multiply(negate(I), log(add(multiply(I, a), sqrt(subtract(ONE, multiply(a, a))))));
}

/** The principal arccosine, π/2 − asin(z): `acos(2)` is 1.317i and `acos(-2)` π − 1.317i, as in SymPy. */
export function acos(a: Complex): Complex {
  if (isReal(a)) {
    if (Math.abs(a.re) <= 1) return complex(Math.acos(a.re));
    return a.re > 1 ? complex(0, Math.acosh(a.re)) : complex(Math.PI, -Math.acosh(-a.re));
  }
  return subtract(complex(HALF_PI), asin(a));
}

/**
 * The principal arctangent, `(i/2)·(log(1 − i·z) − log(1 + i·z))`: on its cuts, the imaginary axis beyond ±i, `atan(2i)` is
 * π/2 + 0.549i, as in SymPy.
 */
export function atan(a: Complex): Complex {
  if (isReal(a)) return complex(Math.atan(a.re));
  const iz = multiply(I, a);
  return multiply(complex(0, 0.5), subtract(log(subtract(ONE, iz)), log(add(ONE, iz))));
}
