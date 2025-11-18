// config/moment.js
require('moment-timezone');
const moment = require('moment');
moment.tz.setDefault('Asia/Karachi');
module.exports = moment;