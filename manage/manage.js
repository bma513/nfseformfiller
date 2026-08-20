const form = document.getElementById("company-form");
const input = document.getElementById("company-name");
const feedback = document.getElementById("feedback");
const companiesNode = document.getElementById("companies");

async function message(payload) {
  const response = await chrome.runtime.sendMessage(payload);
  if (!response?.ok) throw new Error(response?.error || "A operação falhou.");
  return response;
}

function showFeedback(text, isError = false) {
  feedback.textContent = text;
  feedback.className = isError ? "error" : "";
  feedback.hidden = false;
}

async function renderCompanies() {
  const response = await message({ type: "GET_DATA" });
  const companies = Object.values(response.data.companies).sort((left, right) =>
    left.name.localeCompare(right.name, "pt-BR")
  );
  companiesNode.replaceChildren();
  if (!companies.length) {
    const empty = document.createElement("p");
    empty.className = "empty";
    empty.textContent = "Nenhuma empresa cadastrada.";
    companiesNode.append(empty);
    return;
  }
  for (const company of companies) {
    const row = document.createElement("div");
    row.className = "company";
    const name = document.createElement("span");
    name.textContent = company.name;
    const count = document.createElement("span");
    count.textContent = `${Object.keys(company.forms || {}).length} formulário(s)`;
    row.append(name, count);
    companiesNode.append(row);
  }
}

form.addEventListener("submit", async (event) => {
  event.preventDefault();
  const button = form.querySelector("button");
  button.disabled = true;
  try {
    await message({ type: "CREATE_COMPANY", name: input.value });
    input.value = "";
    showFeedback("Empresa cadastrada com sucesso.");
    await renderCompanies();
    input.focus();
  } catch (error) {
    showFeedback(error.message, true);
  } finally {
    button.disabled = false;
  }
});

renderCompanies().catch((error) => showFeedback(error.message, true));
