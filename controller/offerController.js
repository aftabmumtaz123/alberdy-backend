const Offer = require('../model/Offer');
const Product = require('../model/Product');
const AppConfiguration = require('../model/app_configuration'); // Import AppConfiguration model
const mongoose = require('mongoose');
const User = require('../model/User');
const { createNotification } = require('../utils/createNotification');
const sendTemplatedEmail = require('../utils/sendTemplatedEmail');


// Helper: Resolve Product IDs (unchanged)
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

// Helper: Check Overlapping Offers (unchanged)
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

// Helper: Fetch Currency Settings
const getCurrencySettings = async () => {
  try {
    const config = await AppConfiguration.findOne().lean().select('currencyName currencyCode currencySign');
    if (!config) {
      // Fallback if no configuration is found
      return {
        currencyName: 'US Dollar',
        currencyCode: 'USD',
        currencySign: '$',
      };
    }
    return {
      currencyName: config.currencyName,
      currencyCode: config.currencyCode,
      currencySign: config.currencySign,
    };
  } catch (err) {
    console.error('Error fetching currency settings:', err);
    // Fallback on error
    return {
      currencyName: 'US Dollar',
      currencyCode: 'USD',
      currencySign: '$',
    };
  }
};

// Create Offer Controller (unchanged)
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


    // ===============================
// 🔔 NOTIFICATION + EMAIL
// ===============================
try {
  const admins = await User.find({ role: { $in: ['Super Admin', 'Manager'] } })
    .select('_id email name')
    .lean();

  const currency = await getCurrencySettings();
  const sign = currency.currencySign || '$';

  const discountLabel =
    discountType === 'Percentage'
      ? `${discountValue}%`
      : `${sign}${discountValue}`;

  for (const admin of admins) {
    // 🔔 In-app notification
    await createNotification({
      userId: admin._id,
      type: 'offer_created',
      title: 'New Offer Created',
      message: `${offerName} • ${discountLabel} • ${status}`,
      related: {
        offerId: offer._id.toString()
      }
    });

    // 📧 Email
    if (admin.email) {
      const vars = {
        offerName,
        discountType,
        discountValue: discountLabel,
        startDate: new Date(startDate).toDateString(),
        endDate: new Date(endDate).toDateString(),
        status,
        adminOfferUrl: `https://al-bready-admin.vercel.app/admin/offers/${offer._id}`
      };

      await sendTemplatedEmail(admin.email, 'offer_created_admin', vars);
    }
  }

} catch (notifyErr) {
  console.error('Offer notify/email error:', notifyErr);
}



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

    // Current date: Use server's current date (adjusted for PKT if needed)
    const currentDate = new Date(); // Dynamic date, no hardcoded value

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

    // Fetch currency settings
    const currency = await getCurrencySettings();

    res.status(200).json({
      success: true,
      data: {
        offers: offersWithProductCount,
        currency, // Include currency details
      },
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

// Get Offer by ID
const getOfferById = async (req, res) => {
  try {
    const { id } = req.params;
    let offer = await Offer.findById(id).populate('applicableProducts', 'name price brand');

    if (!offer) {
      return res.status(404).json({ message: 'Offer not found' });
    }

    // Current date: Use server's current date
    const currentDate = new Date(); // Dynamic date, no hardcoded value

    if (currentDate > offer.endDate && offer.status === 'active') {
      offer = await Offer.findByIdAndUpdate(
        id,
        { status: 'inactive', updatedAt: currentDate },
        { new: true, runValidators: true }
      ).populate('applicableProducts', 'name price brand');
    }

    // Fetch currency settings
    const currency = await getCurrencySettings();

    const responseData = {
      ...offer.toObject(),
      productCount: offer.applicableProducts.length
    };

    res.status(200).json({
      success: true,
      data: {
        offer: responseData,
        currency, // Include currency details
      }
    });
  } catch (error) {
    console.error('Error fetching offer:', error);
    res.status(500).json({ message: 'Server error fetching offer' });
  }
};

// Update Offer (unchanged)
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

// Delete Offer (unchanged)
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