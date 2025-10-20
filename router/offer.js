// routes/offer.js (or offerRoutes.js) - Fixed with optional middleware
const express = require('express');
const router = express.Router();
const {
  createOffer,
  getAllOffers,
  getOfferById,
  updateOffer,
  deleteOffer
} = require('../controller/offerController');

const auth = require('../middleware/auth'); // Remove isAdmin if not defined yet



router.get('/',getAllOffers); // Temporarily without isAdmin

// GET /api/offers/:id - Get offer by ID
router.get('/:id', getOfferById);

// POST /api/offers - Create new offer
router.post('/', auth, createOffer);

// PUT /api/offers/:id - Update offer
router.put('/:id', auth, updateOffer);

// DELETE /api/offers/:id - Delete offer
router.delete('/:id', auth, deleteOffer)


module.exports = router;
