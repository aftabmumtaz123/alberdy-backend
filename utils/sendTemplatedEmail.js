const EmailTemplate = require('../model/EmailTemplate');
const sendEmail = require('./sendEmail');
const renderTemplate = require('./renderTemplate');

async function sendTemplatedEmail(to, templateType, variables = {}) {
  const template = await EmailTemplate.findOne({
    type: templateType,
    status: 'active'
  }).lean();

  if (!template) {
    console.error(`Email template not found: ${templateType}`);
    return;
  }

  const subject = renderTemplate(template.subject, variables);
  const html = renderTemplate(template.content, variables);

  if (typeof html !== 'string') {
    throw new Error('Rendered HTML is not a string');
  }

  await sendEmail(to, subject, html);
}

module.exports = sendTemplatedEmail;
