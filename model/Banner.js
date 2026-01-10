const mongoose = require('mongoose')

const bannerSchema = mongoose.Schema({
    title: {
        type: String
    },
    description: {
        type: String
    },
    images: [
        {
            url: { type: String, required: true },
            public_id: { type: String, required: true }
        }
    ],
    links: {
        type: [String]
    }
})

const Banner = mongoose.model('Banner', bannerSchema)

module.exports = Banner