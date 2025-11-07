// controllers/offerController.js
const Offer = require('../model/Offer');
const Product = require('../model/Product'); // Assuming Product model exists
const mongoose = require('mongoose');

// Helper to resolve product refs (ID or name) to ObjectIds
const resolveProducts = async (productRefs) => {
  const ids = [];
  for (const ref of productRefs) {
    if (mongoose.Types.ObjectId.isValid(ref)) {
      ids.push(ref);
    } else {
      const product = await Product.findOne({ name: { $regex: new RegExp(`^${ref}$`, 'i') } }); // Case-insensitive exact match
      if (!product) {
        throw new Error(`Product "${ref}" not found`);
      }
      ids.push(product._id);
    }
  }
  // Remove duplicates if any
  return [...new Set(ids)];
};

// Helper to check for overlapping offers for given products and dates
const checkOverlaps = async (applicableProducts, startDate, endDate, excludeOfferId = null) => {
  for (const prodId of applicableProducts) {
    const overlapQuery = {
      applicableProducts: prodId,
      startDate: { $lt: endDate },
      endDate: { $gt: startDate },
      ...(excludeOfferId && { _id: { $ne: excludeOfferId } })
    };
    const count = await Offer.countDocuments(overlapQuery);
    if (count > 0) {
      throw new Error(`Offer on this product is already exist`);
    }
  }
};

// Create Offer
const createOffer = async (req, res) => {
  try {
    const { offerName, discountType, discountValue, applicableProducts, startDate, endDate, status = 'active' } = req.body;

 
    //existing Offer

    // Validate discountValue
    if (discountValue <= 0) {
      return res.status(400).json({ msg: 'Discount value must be positive' });
    }
    if (discountType === 'Percentage' && discountValue > 100) {
      return res.status(400).json({ msg: 'Discount value must be ≤ 100 for Percentage type' });
    }

    // Resolve products (by ID or name) and validate they exist
    const applicableProductIds = await resolveProducts(applicableProducts || []);
    const products = await Product.find({ _id: { $in: applicableProductIds } });
    if (products.length !== applicableProductIds.length) {
      return res.status(400).json({ msg: 'One or more products do not exist' });
    }

    //existing Offer
    const existingOffer = await Offer.findOne({ offerName: offerName });
    if (existingOffer) {
      return res.status(400).json({ msg: 'Offer with this name already exists' });
    }

    // Check for overlaps
    await checkOverlaps(applicableProductIds, new Date(startDate), new Date(endDate));

    const offer = new Offer({
      offerName,
      discountType,
      discountValue,
      applicableProducts: applicableProductIds,
      startDate: new Date(startDate),
      endDate: new Date(endDate),
      status
    });

    await offer.save();

    // Populate products for response
    await offer.populate('applicableProducts', 'name price'); // Add fields as needed

    // Note: Set status to 'active' here, but for auto-activation, consider a cron job to check startDate and set status if >= now

    res.status(201).json({
      success: true,
      data: offer
    });
  } catch (error) {
    console.error('Error creating offer:', error);
    res.status(400).json({ msg: error.message || 'Error creating offer' });
  }
};

// Get All Offers
const getAllOffers = async (req, res) => {
  try {
    const { page = 1, limit , status } = req.query;
    const query = status ? { status } : {};
    const skip = (parseInt(page) - 1) * parseInt(limit);

    const offers = await Offer.find(query)
      .populate('applicableProducts', 'name price brand') // Populate relevant product fields
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(parseInt(limit));

    const total = await Offer.countDocuments(query);

    res.status(200).json({
      success: true,
      data: offers,
      pagination: {
        current: parseInt(page),
        pages: Math.ceil(total / parseInt(limit)),
        total
      }
    });
  } catch (error) {
    console.error('Error fetching offers:', error);
    res.status(500).json({ msg: 'Server error fetching offers' });
  }
};

// Get Offer by ID
const getOfferById = async (req, res) => {
  try {
    const { id } = req.params;
    const offer = await Offer.findById(id).populate('applicableProducts', 'name price brand');
    if (!offer) {
      return res.status(404).json({ msg: 'Offer not found' });
    }
    res.status(200).json({
      success: true,
      data: offer
    });
  } catch (error) {
    console.error('Error fetching offer:', error);
    res.status(500).json({ msg: 'Server error fetching offer' });
  }
};

// Update Offer
const updateOffer = async (req, res) => {
  try {
    const { id } = req.params;
    const updateData = req.body;
    const offer = await Offer.findById(id);
    if (!offer) {
      return res.status(404).json({ msg: 'Offer not found' });
    }

    // If updating dates or products, re-validate
    if (updateData.startDate || updateData.endDate || updateData.applicableProducts !== undefined) {
      const newStart = updateData.startDate ? new Date(updateData.startDate) : offer.startDate;
      const newEnd = updateData.endDate ? new Date(updateData.endDate) : offer.endDate;
      let newProducts = updateData.applicableProducts !== undefined ? await resolveProducts(updateData.applicableProducts) : offer.applicableProducts.map(p => p._id.toString());

   

      // Validate products if changed
      if (updateData.applicableProducts !== undefined) {
        const products = await Product.find({ _id: { $in: newProducts } });
        if (products.length !== newProducts.length) {
          return res.status(400).json({ msg: 'One or more products do not exist' });
        }
      }

      // Check overlaps, excluding self
      await checkOverlaps(newProducts, newStart, newEnd, id);
    }

    // Update discount if provided
    if (updateData.discountValue !== undefined) {
      if (updateData.discountValue <= 0) {
        return res.status(400).json({ msg: 'Discount value must be positive' });
      }
      if (updateData.discountType === 'Percentage' && updateData.discountValue > 100) {
        return res.status(400).json({ msg: 'Discount value must be ≤ 100 for Percentage type' });
      }
    }

    const updatedOffer = await Offer.findByIdAndUpdate(id, updateData, { new: true, runValidators: true })
      .populate('applicableProducts', 'name price brand');

    res.status(200).json({
      success: true,
      data: updatedOffer
    });
  } catch (error) {
    console.error('Error updating offer:', error);
    res.status(400).json({ msg: error.message || 'Error updating offer' });
  }
};

// Delete Offer
const deleteOffer = async (req, res) => {
  try {
    const { id } = req.params;
    const offer = await Offer.findById(id);
    if (!offer) {
      return res.status(404).json({ msg: 'Offer not found' });
    }

    // No need to revert prices if computed dynamically; just delete
    await Offer.findByIdAndDelete(id);

    res.status(200).json({
      success: true,
      msg: 'Offer deleted successfully'
    });
  } catch (error) {
    console.error('Error deleting offer:', error);
    res.status(500).json({ msg: 'Server error deleting offer' });
  }
};

module.exports = {
  createOffer,
  getAllOffers,
  getOfferById,
  updateOffer,
  deleteOffer

};
