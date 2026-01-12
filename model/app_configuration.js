const mongoose = require('mongoose');


const appConfigurationSchema = new mongoose.Schema({
  appName: {
    type: String,
    required: true,
    trim: true,
  },
  tax: {
    type: Number,
  },
  appLogo: {
    type: String, 
    trim: true,
  },
  primaryColor: {
    type: String, 
    required: true,
    trim: true,
  },
  secondaryColor: {
    type: String, 
    required: true,
    trim: true,
  },
  aboutUs: {
    type: String,
    trim: true,
  },
  contactEmails: {
    type: [String],
    trim: true,
   
  },
  supportPhones: {
    type: [String],
    trim: true,
  },



  street_address: {
    type: String,
    trim: true,
  },

  zip_code: {
    type: String,
    trim: true,
  },

  currencyName: {
    type: String
  },
  currencyCode: {
    type: String
  },

  currencySign: {
    type: String
  },
  
  facebook: { type: String, trim: true },
  instagram: { type: String, trim: true },
  youtube: { type: String, trim: true },
  linkedin: { type: String, trim: true },
  lastUpdated: {
    type: String, 
    default: new Date().toISOString(),
  },
}, { timestamps: true }); 

module.exports = mongoose.model('AppConfiguration', appConfigurationSchema);