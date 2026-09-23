//! Integer-only foundational arithmetic. Market scale is always explicit.
use crate::{encode, integer};
use num_bigint::BigInt;
use num_traits::{Signed, Zero};

fn qty(x: &BigInt) -> Result<(), String> {
    encode("qty", &x.to_string())?;
    Ok(())
}
pub fn reduction(p: &BigInt, d: &BigInt) -> Result<bool, String> {
    qty(p)?;
    qty(d)?;
    let n = p + d;
    qty(&n)?;
    Ok(n.abs() <= p.abs() && &n * p >= BigInt::zero())
}
pub fn ceil_div(n: &BigInt, d: &BigInt) -> Result<BigInt, String> {
    if n.is_negative() || d <= &BigInt::zero() {
        return Err("invalid division".into());
    }
    Ok((n + d - 1) / d)
}
pub fn minimum_reduction(p: &BigInt, bps: &BigInt) -> Result<BigInt, String> {
    qty(p)?;
    encode("bps", &bps.to_string())?;
    if bps > &BigInt::from(10000) {
        return Err("fraction above 100%".into());
    }
    ceil_div(&(p.abs() * bps), &BigInt::from(10000))
}
pub fn custody_draw(
    margin: &BigInt,
    credit: &BigInt,
    available: &BigInt,
) -> Result<BigInt, String> {
    for x in [margin, credit, available] {
        encode("amount", &x.to_string())?;
    }
    if credit.is_negative() || available.is_negative() {
        return Err("negative capital".into());
    }
    let draw = (margin - credit).max(BigInt::zero());
    if &draw > available {
        return Err("insufficient capital".into());
    }
    Ok(draw)
}
pub fn notional(p: &[String]) -> Result<BigInt, String> {
    if p.len() != 4 {
        return Err("market scale required".into());
    }
    encode("qty", &p[0])?;
    encode("price", &p[1])?;
    let v = p
        .iter()
        .map(|x| integer(x))
        .collect::<Result<Vec<_>, _>>()?;
    if v[1] <= BigInt::zero() || v[2] <= BigInt::zero() || v[3] <= BigInt::zero() {
        return Err("invalid market scale/mark".into());
    }
    ceil_div(&(v[0].abs() * &v[1] * &v[2]), &v[3])
}
pub fn leverage(
    positions: &[Vec<String>],
    equity: &BigInt,
    haircut: &BigInt,
    limit: &BigInt,
) -> Result<bool, String> {
    encode("amount", &equity.to_string())?;
    encode("bps", &haircut.to_string())?;
    encode("bps", &limit.to_string())?;
    let b = BigInt::from(10000);
    if haircut > &b {
        return Err("haircut above 100%".into());
    }
    let mut gross = BigInt::zero();
    for p in positions {
        gross += notional(p)?;
    }
    Ok(gross * &b * &b <= equity.clone().max(BigInt::zero()) * (&b - haircut) * limit)
}
