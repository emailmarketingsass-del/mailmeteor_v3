// src/services/templating.js
const Handlebars = require("handlebars");

/**
 * Render a template string (html or text) with contact fields.
 * @param {string} templateStr
 * @param {object} context
 * @returns {string}
 */
function renderTemplate(templateStr, context = {}) {
  try {
    const template = Handlebars.compile(templateStr || "", { noEscape: false });
    return template(context || {});
  } catch (err) {
    console.error("Template render error:", err);
    // return original string if error (safer for now)
    return templateStr;
  }
}

module.exports = { renderTemplate };
