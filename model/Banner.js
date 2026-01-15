const mongoose = require('mongoose')

const bannerSchema = mongoose.Schema({
    title: {
        type: String
    },
    subTitle: {
        type: String
    },
    bannerLayout: {
        type: String
    },
    buttonText: {
        type: String
    },
    buttonLink: {
        type: String
    },
    buttonPosition: {
        type: String
    },
    description: {
        type: String
    },
    images:
    {
        type: String
    },
    links: {
        type: [String]
    },
    status: {
        type: String,
        enum: ['Active', 'Inactive'],
        default: "Active"
    }
}, { timestamps: true })

const Banner = mongoose.model('Banner', bannerSchema)

module.exports = Banner