export function moneyCents(value, allowZero = false) {
  const s = String(value ?? "").trim();
  if (!/^\d{1,9}(\.\d{1,2})?$/.test(s))
    throw new Error("Enter a USD amount with up to two decimal places.");
  const [whole, fraction = ""] = s.split(".");
  const result = Number(whole) * 100 + Number(fraction.padEnd(2, "0"));
  if (!allowZero && !result)
    throw new Error("The amount must be greater than zero.");
  return result;
}
export function annualSchedule(annualRent, years, changes = []) {
  if (!Number.isInteger(years) || years < 1 || years > 50)
    throw new Error("Choose a contract length from 1 to 50 years.");
  if (!Array.isArray(changes) || changes.length > 50)
    throw new Error("Use at most 50 rent changes.");
  const rules = changes
    .map((c) => {
      if (
        !c ||
        !Number.isInteger(c.year) ||
        c.year < 2 ||
        c.year > years ||
        !["percent", "add", "set"].includes(c.type) ||
        typeof c.repeat !== "boolean"
      )
        throw new Error(
          "Each rent change needs a year within the contract, a type, and a repeat choice.",
        );
      const value = moneyCents(c.value, true);
      if (c.type === "percent" && value > 100000)
        throw new Error("Percentage increases must be at most 1,000%.");
      if (c.type === "set" && !value)
        throw new Error("Annual rent must be greater than zero.");
      return { ...c, value };
    })
    .sort((a, b) => a.year - b.year);
  let amount = moneyCents(annualRent);
  return Array.from({ length: years }, (_, i) => {
    const year = i + 1;
    for (const rule of rules)
      if (rule.year === year || (rule.repeat && rule.year < year)) {
        if (rule.type === "set") amount = rule.value;
        if (rule.type === "add") amount += rule.value;
        if (rule.type === "percent")
          amount += Number(
            (BigInt(amount) * BigInt(rule.value) + 5000n) / 10000n,
          );
      }
    if (!Number.isSafeInteger(amount) || amount <= 0 || amount > 99999999999)
      throw new Error(
        "The resulting annual rent is outside the supported range.",
      );
    return { year, amount };
  });
}
