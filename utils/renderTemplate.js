function renderTemplate(template, variables = {}) {
  let html = template;

  for (const key in variables) {
    const regex = new RegExp(`{{${key}}}`, 'g');
    html = html.replace(regex, variables[key]);
  }

  return html;
}

module.exports = renderTemplate;
