use metropolis_reference::{delta, domain, encode, integer, model, Codec};
use serde_json::{json, Value};
use std::io::{self, Read};

fn string(v: &Value) -> Result<&str, String> {
    v.as_str().ok_or("string required".into())
}
fn strings(v: &Value) -> Result<Vec<String>, String> {
    v.as_array()
        .ok_or("array required")?
        .iter()
        .map(|x| string(x).map(str::to_owned))
        .collect()
}
fn matrix(v: &Value) -> Result<Vec<Vec<String>>, String> {
    v.as_array()
        .ok_or("matrix required")?
        .iter()
        .map(strings)
        .collect()
}
fn run(c: &Codec, v: &Value) -> Result<Value, String> {
    Ok(match string(&v["op"])? {
        "encode" => json!(encode(string(&v["type"])?, string(&v["value"])?)?.to_string()),
        "domain" => json!(domain(string(&v["name"])?)?.to_string()),
        "hash" => json!(c
            .hash(string(&v["name"])?, &strings(&v["values"])?)?
            .to_string()),
        "delta" => json!(delta(
            string(&v["target"])?,
            string(&v["position"])?,
            string(&v["open"])?
        )?
        .to_string()),
        "reduction" => json!(model::reduction(
            &integer(string(&v["position"])?)?,
            &integer(string(&v["delta"])?)?
        )?),
        "minimumReduction" => json!(model::minimum_reduction(
            &integer(string(&v["position"])?)?,
            &integer(string(&v["bps"])?)?
        )?
        .to_string()),
        "custodyDraw" => json!(model::custody_draw(
            &integer(string(&v["margin"])?)?,
            &integer(string(&v["credit"])?)?,
            &integer(string(&v["available"])?)?
        )?
        .to_string()),
        "notional" => json!(model::notional(&strings(&v["position"])?)?.to_string()),
        "leverage" => json!(model::leverage(
            &matrix(&v["positions"])?,
            &integer(string(&v["equity"])?)?,
            &integer(string(&v["haircut"])?)?,
            &integer(string(&v["limit"])?)?
        )?),
        "intent" => {
            let (a, b) = c.intent(
                &strings(&v["header"])?,
                &matrix(&v["targets"])?,
                string(&v["salt"])?,
            )?;
            json!({"intentComm":a.to_string(),"sigMsg":b.to_string()})
        }
        "note" => {
            let (a, b) = c.note(
                &strings(&v["header"])?,
                &matrix(&v["slots"])?,
                &strings(&v["anchor"])?,
                string(&v["secret"])?,
            )?;
            json!({"noteComm":a.to_string(),"nullifier":b.to_string()})
        }
        _ => return Err("unknown operation".into()),
    })
}
fn main() -> Result<(), Box<dyn std::error::Error>> {
    let mut input = String::new();
    io::stdin().read_to_string(&mut input)?;
    let vectors: Vec<Value> = serde_json::from_str(&input)?;
    let codec = Codec::default();
    let results: Vec<Value> = vectors
        .iter()
        .map(|v| match run(&codec, v) {
            Ok(x) => json!({"ok":x}),
            Err(_) => json!({"error":true}),
        })
        .collect();
    println!("{}", serde_json::to_string(&results)?);
    Ok(())
}
