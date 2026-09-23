//! Independent draft v0.1 encoding oracle. No keys, networking, venue, or custody.
use ff::PrimeField;
use num_bigint::{BigInt, BigUint, Sign};
use num_traits::{One, Zero};
use poseidon_rs::{Fr, Poseidon};
use sha3::{Digest, Keccak256};
use std::str::FromStr;
pub mod model;

pub const MODULUS: &str =
    "21888242871839275222246405745257275088548364400416034343698204186575808495617";
pub const DOMAINS: &str = "INTENT INTENT_HDR TARGETS SIG NOTE NOTE_HDR SLOTS ANCHOR NF EXEC SNAP ACC LEDGER_LEAF NAV ESCAPE LEASE_REC SIGNALS KEY";
pub fn field() -> BigInt {
    BigInt::from_str(MODULUS).unwrap()
}
pub fn integer(s: &str) -> Result<BigInt, String> {
    let x = BigInt::from_str(s).map_err(|_| "integer")?;
    if x.to_string() != s {
        return Err("canonical decimal integer required".into());
    }
    Ok(x)
}
pub fn encode(kind: &str, s: &str) -> Result<BigInt, String> {
    let x = integer(s)?;
    let bits = match kind {
        "u64" => 64,
        "price" => 96,
        "bps" => 16,
        "address" => 160,
        "bool" => 1,
        "bytes32" => 256,
        "qty" => 63,
        "amount" => 128,
        _ => 0,
    };
    if bits > 0 {
        let bound: BigInt = BigInt::one() << bits;
        if kind == "qty" || kind == "amount" {
            if x <= -&bound || x >= bound {
                return Err("signed range".into());
            }
            return Ok(if x.sign() == Sign::Minus {
                field() + x
            } else {
                x
            });
        }
        if x < BigInt::zero() || x >= bound {
            return Err("unsigned range".into());
        }
        return Ok(if kind == "bytes32" {
            x & ((BigInt::one() << 253) - 1)
        } else {
            x
        });
    }
    let allowed: &[i32] = match kind {
        "side" | "leaseOp" => &[1, 2],
        "tif" => &[1],
        "authMode" => &[0, 1],
        "snapCause" => &[1, 2, 3, 4],
        "hash" => &[],
        _ => return Err("unknown scalar type".into()),
    };
    if kind == "hash" {
        if x < BigInt::zero() || x >= field() {
            return Err("noncanonical field".into());
        }
    } else if !allowed.iter().any(|n| x == BigInt::from(*n)) {
        return Err("enum".into());
    }
    Ok(x)
}
pub fn domain(name: &str) -> Result<BigInt, String> {
    if !DOMAINS.split_whitespace().any(|x| x == name) {
        return Err("unknown domain".into());
    }
    Ok(BigInt::from_bytes_be(
        Sign::Plus,
        &Keccak256::digest(format!("monad-metropolis/v1/{name}")),
    ) % field())
}
fn schema(name: &str) -> Result<Vec<&'static str>, String> {
    Ok(match name {
        "INTENT_HDR" => vec![
            "u64", "u64", "u64", "u64", "u64", "bps", "tif", "u64", "u64",
        ],
        "TARGETS" => (0..7).flat_map(|_| ["u64", "qty"]).collect(),
        "INTENT" | "KEY" => vec!["hash", "hash", "hash"],
        "SIG" => vec!["hash", "u64"],
        "NOTE_HDR" => vec![
            "u64", "u64", "u64", "u64", "hash", "u64", "bool", "amount", "u64", "hash", "u64",
        ],
        "SLOT" => vec!["address", "u64", "u64", "qty", "u64"],
        "SLOT_GROUP" => vec!["hash"; 8],
        "SLOTS" | "ACC" => vec!["hash", "hash"],
        "ANCHOR" => vec!["hash", "u64", "amount"],
        "NOTE_SECRET" => vec!["hash", "u64"],
        "NOTE" => vec!["hash"; 4],
        "NF" => vec!["hash", "u64", "u64"],
        "EXEC" => vec![
            "address", "u64", "u64", "qty", "price", "tif", "u64", "amount", "bool", "authMode",
            "hash",
        ],
        "SNAP" => vec![
            "address",
            "u64",
            "u64",
            "qty",
            "price",
            "amount",
            "amount",
            "amount",
            "price",
            "u64",
            "snapCause",
            "amount",
        ],
        "LEASE_REC" => vec!["address", "u64", "u64", "leaseOp", "hash"],
        "LEDGER_LEAF" => vec![
            "u64", "amount", "price", "amount", "amount", "hash", "hash", "hash", "u64",
        ],
        _ => return Err("unknown hash schema".into()),
    })
}
pub struct Codec {
    poseidon: Poseidon,
}
impl Default for Codec {
    fn default() -> Self {
        Self {
            poseidon: Poseidon::new(),
        }
    }
}
impl Codec {
    pub fn hash(&self, name: &str, values: &[String]) -> Result<BigInt, String> {
        let types = schema(name)?;
        if types.len() != values.len() {
            return Err("hash arity".into());
        }
        let mut inputs = types
            .iter()
            .zip(values)
            .map(|(t, v)| encode(t, v))
            .collect::<Result<Vec<_>, _>>()?;
        if !["SLOT", "SLOT_GROUP", "NOTE_SECRET"].contains(&name) {
            inputs.insert(0, domain(name)?);
        }
        let elements = inputs
            .iter()
            .map(|x| Fr::from_str(&x.to_string()).ok_or("field conversion".to_string()))
            .collect::<Result<Vec<_>, _>>()?;
        let result = self.poseidon.hash(elements)?.into_repr();
        let bytes: Vec<u8> = result
            .as_ref()
            .iter()
            .flat_map(|x| x.to_le_bytes())
            .collect();
        Ok(BigInt::from(BigUint::from_bytes_le(&bytes)))
    }
    pub fn intent(
        &self,
        header: &[String],
        targets: &[Vec<String>],
        salt: &str,
    ) -> Result<(BigInt, BigInt), String> {
        if header.len() != 8
            || targets.is_empty()
            || targets.len() > 7
            || targets.iter().any(|t| t.len() != 2)
        {
            return Err("intent shape".into());
        }
        let mut markets = std::collections::HashSet::new();
        for t in targets {
            if !markets.insert(encode("u64", &t[0])?) {
                return Err("duplicate market".into());
            }
        }
        let mut h = header.to_vec();
        h.push(targets.len().to_string());
        let mut flat: Vec<String> = targets.iter().flatten().cloned().collect();
        flat.resize(14, "0".into());
        let comm = self.hash(
            "INTENT",
            &[
                self.hash("INTENT_HDR", &h)?.to_string(),
                self.hash("TARGETS", &flat)?.to_string(),
                salt.into(),
            ],
        )?;
        let sig = self.hash("SIG", &[comm.to_string(), header[3].clone()])?;
        Ok((comm, sig))
    }
    pub fn note(
        &self,
        header: &[String],
        slots: &[Vec<String>],
        anchor: &[String],
        secret: &str,
    ) -> Result<(BigInt, BigInt), String> {
        if header.len() != 11
            || slots.len() > 16
            || integer(&header[8])? != BigInt::from(slots.len())
        {
            return Err("note slot count".into());
        }
        let mut markets = std::collections::HashSet::new();
        let mut leaves = Vec::new();
        for s in slots {
            leaves.push(self.hash("SLOT", s)?.to_string());
            if !markets.insert(encode("u64", &s[1])?) {
                return Err("duplicate slot market".into());
            }
        }
        leaves.resize(16, "0".into());
        let sh = self.hash(
            "SLOTS",
            &[
                self.hash("SLOT_GROUP", &leaves[..8])?.to_string(),
                self.hash("SLOT_GROUP", &leaves[8..])?.to_string(),
            ],
        )?;
        let ns = self.hash("NOTE_SECRET", &[secret.into(), header[1].clone()])?;
        let comm = self.hash(
            "NOTE",
            &[
                self.hash("NOTE_HDR", header)?.to_string(),
                sh.to_string(),
                self.hash("ANCHOR", anchor)?.to_string(),
                ns.to_string(),
            ],
        )?;
        let nf = self.hash(
            "NF",
            &[ns.to_string(), header[0].clone(), header[1].clone()],
        )?;
        Ok((comm, nf))
    }
}

/// IOC-only delta; quantity overflow is rejected before field conversion.
pub fn delta(target: &str, position: &str, open: &str) -> Result<BigInt, String> {
    for x in [target, position, open] {
        encode("qty", x)?;
    }
    if integer(open)? != BigInt::zero() {
        return Err("IOC requires no open orders".into());
    }
    let d = integer(target)? - integer(position)?;
    encode("qty", &d.to_string())?;
    Ok(d)
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn amount_is_wider_than_i128() {
        assert!(encode("amount", "340282366920938463463374607431768211455").is_ok());
        assert!(encode("amount", "340282366920938463463374607431768211456").is_err());
    }
    #[test]
    fn no_field_aliases() {
        assert!(encode("hash", MODULUS).is_err());
        assert!(encode("qty", "-9223372036854775808").is_err());
    }
    #[test]
    fn delta_must_fit() {
        assert!(delta("9223372036854775807", "-1", "0").is_err());
        assert!(delta("0", "100", "1").is_err());
    }
}
