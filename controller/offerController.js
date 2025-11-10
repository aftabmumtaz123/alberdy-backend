const Offer = require('../model/Offer');
const Product = require('../model/Product');
const mongoose = require('mongoose');

// Helper: Resolve Product IDs
const resolveProducts = async (productRefs) => {
  const ids = [];
  for (const ref of productRefs) {
    if (mongoose.Types.ObjectId.isValid(ref)) {
      ids.push(ref);
    } else {
      const product = await Product.findOne({
        name: { $regex: new RegExp(`^${ref}$`, 'i') }
      });
      if (!product) {
        throw new Error(`Product "${ref}" not found`);
      }
      ids.push(product._id);
    }
  }
  return [...new Set(ids)];
};

// Helper: Check Overlapping Offers
const checkOverlaps = async (applicableProducts, startDate, endDate, excludeOfferId = null) => {
  const now = new Date();
  for (const prodId of applicableProducts) {
    const overlapQuery = {
      applicableProducts: prodId,
      startDate: { $lt: endDate },
      endDate: { $gt: startDate },
      endDate: { $gte: now }, // ignore expired offers
      status: { $in: ['active', 'upcoming'] }, // ignore inactive ones
      ...(excludeOfferId && { _id: { $ne: excludeOfferId } })
    };
    const existingOffer = await Offer.findOne(overlapQuery)
      .populate('applicableProducts', 'name')
      .select('offerName applicableProducts');
    if (existingOffer) {
      throw new Error(
        `Product "${existingOffer.applicableProducts[0]?.name || 'Unknown'}" already has an active or upcoming offer ("${existingOffer.offerName}")`
      );
    }
  }
};

// Create Offer Controller (unchanged, included for context)
const createOffer = async (req, res) => {
  try {
    const { offerName, discountType, discountValue, applicableProducts, startDate, endDate, status = 'active' } = req.body;
    if (discountValue <= 0) {
      return res.status(400).json({ message: 'Discount value must be positive' });
    }
    if (discountType === 'Percentage' && discountValue > 100) {
      return res.status(400).json({ message: 'Discount value must be ≤ 100 for Percentage type' });
    }
    const existingOffer = await Offer.findOne({ offerName });
    if (existingOffer) {
      return res.status(400).json({ message: 'Offer with this name already exists' });
    }
    const applicableProductIds = await resolveProducts(applicableProducts || []);
    const products = await Product.find({ _id: { $in: applicableProductIds } });
    if (products.length !== applicableProductIds.length) {
      return res.status(400).json({ message: 'One or more products do not exist' });
    }
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
    await offer.populate('applicableProducts', 'name price');
    res.status(201).json({
      success: true,
      data: offer
    });
  } catch (error) {
    console.error('Error creating offer:', error);
    res.status(400).json({ message: error.message || 'Error creating offer' });
  }
};

// Get All Offers
const getAllOffers = async (req, res) => {
  try {
    const { page = 1, limit = 10, status } = req.query;
    const query = status ? { status } : {};
    const skip = (parseInt(page) - 1) * parseInt(limit);

    // Fetch offers and populate applicable products
    const offers = await Offer.find(query)
      .populate('applicableProducts', 'name price brand')
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(parseInt(limit));

    const total = await Offer.countDocuments(query);

    // Current date: 12:23 PM PKT, November 10, 2025
    const currentDate = new Date('2025-11-10T12:23:00+05:00'); // Explicitly set to PKT

    // Update status for expired offers and re-fetch if needed
    const updatedOffers = await Promise.all(offers.map(async (offer) => {
      if (currentDate > offer.endDate && offer.status === 'active') {
        const updatedOffer = await Offer.findByIdAndUpdate(
          offer._id,
          { status: 'inactive', updatedAt: currentDate },
          { new: true, runValidators: true }
        ).populate('applicableProducts', 'name price brand');
        return updatedOffer;
      }
      return offer;
    }));

    // Enhance offers with product count
    const offersWithProductCount = updatedOffers.map(offer => ({
      ...offer.toObject(),
      productCount: offer.applicableProducts.length
    }));

    res.status(200).json({
      success: true,
      data: offersWithProductCount,
      pagination: {
        current: parseInt(page),
        pages: Math.ceil(total / parseInt(limit)),
        total
      }
    });
  } catch (error) {
    console.error('Error fetching offers:', error);
    res.status(500).json({ message: 'Server error fetching offers' });
  }
};

// Get Offer by ID (unchanged, included for context)
const getOfferById = async (req, res) => {
  try {
    const { id } = req.params;
    let offer = await Offer.findById(id).populate('applicableProducts', 'name price brand');

    if (!offer) {
      return res.status(404).json({ message: 'Offer not found' });
    }

    const currentDate = new Date('2025-11-10T12:23:00+05:00'); // Explicitly set to PKT
    if (currentDate > offer.endDate && offer.status === 'active') {
      offer = await Offer.findByIdAndUpdate(
        id,
        { status: 'inactive', updatedAt: currentDate },
        { new: true, runValidators: true }
      ).populate('applicableProducts', 'name price brand');
    }

    const responseData = {
      ...offer.toObject(),
      productCount: offer.applicableProducts.length
    };

    res.status(200).json({
      success: true,
      data: responseData
    });
  } catch (error) {
    console.error('Error fetching offer:', error);
    res.status(500).json({ message: 'Server error fetching offer' });
  }
};

// Update Offer (unchanged, included for context)
const updateOffer = async (req, res) => {
  try {
    const { id } = req.params;
    const updateData = req.body;
    const offer = await Offer.findById(id);
    if (!offer) {
      return res.status(404).json({ message: 'Offer not found' });
    }
    if (updateData.startDate || updateData.endDate || updateData.applicableProducts !== undefined) {
      const newStart = updateData.startDate ? new Date(updateData.startDate) : offer.startDate;
      const newEnd = updateData.endDate ? new Date(updateData.endDate) : offer.endDate;
      const newStatus = updateData.status ? updateData.status : offer.status;
      let newProducts = updateData.applicableProducts !== undefined ? await resolveProducts(updateData.applicableProducts) : offer.applicableProducts.map(p => p._id.toString());

      if (updateData.applicableProducts !== undefined) {
        const products = await Product.find({ _id: { $in: newProducts } });
        if (products.length !== newProducts.length) {
          return res.status(400).json({ message: 'One or more products do not exist' });
        }
      }
      await checkOverlaps(newProducts, newStart, newEnd, id);
    }
    if (updateData.discountValue !== undefined) {
      if (updateData.discountValue <= 0) {
        return res.status(400).json({ message: 'Discount value must be positive' });
      }
      if (updateData.discountType === 'Percentage' && updateData.discountValue > 100) {
        return res.status(400).json({ message: 'Discount value must be ≤ 100 for Percentage type' });
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
    res.status(400).json({ message: error.message || 'Error updating offer' });
  }
};

// Delete Offer (unchanged, included for context)
const deleteOffer = async (req, res) => {
  try {
    const { id } = req.params;
    const offer = await Offer.findById(id);
    if (!offer) {
      return res.status(404).json({ message: 'Offer not found' });
    }
    await Offer.findByIdAndDelete(id);
    res.status(200).json({
      success: true,
      message: 'Offer deleted successfully'
    });
  } catch (error) {
    console.error('Error deleting offer:', error);
    res.status(500).json({ message: 'Server error deleting offer' });
  }
};

module.exports = {
  createOffer,
  getAllOffers,
  getOfferById,
  updateOffer,
  deleteOffer
};

