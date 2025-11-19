// controllers/inventoryController.js
const Variant = require('../model/variantProduct');
const StockMovement = require('../model/StockMovement');
const mongoose = require('mongoose');

const getPerformedBy = async (req) => {
  if (req.user?._id) return req.user._id;
  const User = mongoose.model('User');
  const admin = await User.findOne({ role: { $in: ['Admin', 'Inventory Manager', 'Staff'] } }).lean();
  return admin?._id || new mongoose.Types.ObjectId("507f1f77bcf86cd799439011");
};

// Auto generate reference ID if not provided
const generateReferenceId = () => `ADJ-${Date.now()}-${Math.floor(Math.random() * 10000)}`;

// Core stock adjustment (shared between add & update)
const adjustStock = async (req, res, variantIdFromParam = null) => {
  const session = await mongoose.startSession();
  session.startTransaction();

  try {
    const {
      variantId: bodyVariantId,
      quantityChange,
      isStockIncreasing,
      movementType,        // ← NOW ACCEPT ANY STRING FROM FRONTEND (NO VALIDATION)
      reason,
      referenceId,
      expiryAlertDate
    } = req.body;

    const variantId = variantIdFromParam || bodyVariantId;

    // === BASIC REQUIRED VALIDATION ===
    if (!variantId || !mongoose.Types.ObjectId.isValid(variantId)) {
      return res.status(400).json({ success: false, msg: "Valid variantId is required" });
    }

    if (quantityChange === undefined || quantityChange === null) {
      return res.status(400).json({ success: false, msg: "quantityChange is required" });
    }

    if (isStockIncreasing === undefined) {
      return res.status(400).json({ success: false, msg: "isStockIncreasing (true/false) is required" });
    }

    if (!reason?.trim()) {
      return res.status(400).json({ success: false, msg: "Reason is required" });
    }

    // movementType can be ANY string — no validation at all
    const movementTypeStr = (movementType || 'Manual Adjustment').toString().trim();

    const qty = Math.abs(Number(quantityChange));
    if (isNaN(qty) || qty === 0) {
      return res.status(400).json({ success: false, msg: "quantityChange must be a positive non-zero number" });
    }

    const changeAmount = isStockIncreasing ? qty : -qty;

    // === FIND VARIANT ===
    const variant = await Variant.findById(variantId)
      .populate('product', 'name')
      .session(session);

    if (!variant) {
      await session.abortTransaction();
      return res.status(404).json({ success: false, msg: "Variant not found" });
    }

    // === PREVENT NEGATIVE STOCK ===
    if (variant.stockQuantity + changeAmount < 0) {
      await session.abortTransaction();
      return res.status(400).json({
        success: false,
        msg: `Cannot reduce below zero. Current stock: ${variant.stockQuantity}`
      });
    }

    const previousQty = variant.stockQuantity;
    variant.stockQuantity += changeAmount;

    // Optional expiry update
    if (expiryAlertDate) {
      const exp = new Date(expiryAlertDate);
      if (!isNaN(exp.getTime())) {
        variant.expiryDate = exp;
      }
    }

    await variant.save({ session });

    // Auto generate reference if not provided
    const finalRefId = referenceId?.trim() || generateReferenceId();

    // === RECORD STOCK MOVEMENT ===
    await StockMovement.create([{
      variant: variant._id,
      sku: variant.sku,
      previousQuantity: previousQty,
      newQuantity: variant.stockQuantity,
      changeQuantity: changeAmount,
      isStockIncreasing: isStockIncreasing === true,
      movementType: movementTypeStr,           // ← ANY STRING ALLOWED
      reason: reason.trim(),
      referenceId: finalRefId,
      performedBy: await getPerformedBy(req),
    }], { session });

    await session.commitTransaction();

    // === SUCCESS RESPONSE ===
    res.json({
      success: true,
      msg: isStockIncreasing ? "Stock increased" : "Stock decreased",
      data: {
        variantId: variant._id,
        productName: variant.product?.name || "Unknown",
        sku: variant.sku,
        previousQuantity: previousQty,
        newQuantity: variant.stockQuantity,
        change: changeAmount,
        movementType: movementTypeStr,
        referenceId: finalRefId,
        isStockIncreasing: isStockIncreasing === true,
        performedBy: req.user?.name || "System",
        performedAt: new Date().toISOString(),
        reason: reason.trim(),

      }
    });

  } catch (err) {
    await session.abortTransaction();
    console.error("Stock Adjustment Error:", err);
    res.status(500).json({ success: false, msg: "Server error", error: err.message });
  } finally {
    session.endSession();
  }
};

// ======================
// EXPORTS
// ======================

exports.addInventory    = (req, res) => adjustStock(req, res);
exports.updateInventory = (req, res) => adjustStock(req, res, req.params.variantId);

// Dashboard (unchanged – perfect as is)
exports.getInventoryDashboard = async (req, res) => {
  try {
    const { search = "", sort = "name", page = 1, limit = 20 } = req.query;
    const pageNum = Math.max(1, parseInt(page) || 1);
    const limitNum = Math.max(1, Math.min(100, parseInt(limit) || 20));
    const skip = (pageNum - 1) * limitNum;

    const searchFilter = search ? {
      $or: [
        { "product.name": { $regex: search, $options: "i" } },
        { sku: { $regex: search, $options: "i" } },
        { "product.brand.brandName": { $regex: search, $options: "i" } },
        { "product.category.name": { $regex: search, $options: "i" } },
      ]
    } : {};

    const variants = await Variant.aggregate([
      { $match: { isDeleted: { $ne: true }, status: { $ne: "Discontinued" }, ...searchFilter } },
      { $lookup: { from: "products", localField: "product", foreignField: "_id", as: "product" } },
      { $unwind: "$product" },
      { $lookup: { from: "brands", localField: "product.brand", foreignField: "_id", as: "product.brand" } },
      { $unwind: { path: "$product.brand", preserveNullAndEmptyArrays: true } },
      { $lookup: { from: "categories", localField: "product.category", foreignField: "_id", as: "product.category" } },
      { $unwind: { path: "$product.category", preserveNullAndEmptyArrays: true } },

      {
        $addFields: {
          productName: "$product.name",
          brandName: "$product.brand.brandName",
          categoryName: "$product.category.name",
          thumbnail: { $ifNull: ["$image", "$product.thumbnail", "/placeholder.jpg"] },
          statusLabel: {
            $cond: {
              if: { $and: ["$expiryDate", { $lt: ["$expiryDate", new Date()] }] },
              then: "Expired",
              else: { $cond: [{ $lte: ["$stockQuantity", 10] }, "Low Stock", "Good"] }
            }
          }
        }
      },

      { $sort: { ...(sort === "name" && { productName: 1 }), ...(sort === "stock" && { stockQuantity: 1 }), updatedAt: -1 } },
      { $skip: skip },
      { $limit: limitNum },

      {
        $project: {
          variantId: "$_id",
          _id: 1,
          productName: 1,
          brandName: 1,
          categoryName: 1,
          thumbnail: 1,
          sku: 1,
          stockQuantity: 1,
          expiryDate: 1,
          statusLabel: 1,
          updatedAt: 1,
        }
      }
    ]);

    const total = await Variant.countDocuments({ isDeleted: { $ne: true }, status: { $ne: "Discontinued" }, ...searchFilter });

    res.json({
      success: true,
      data: variants,
      pagination: { total, page: pageNum, pages: Math.ceil(total / limitNum), limit: limitNum }
    });
  } catch (err) {
    console.error("Dashboard Error:", err);
    res.status(500).json({ success: false, msg: "Failed to load inventory" });
  }
};

// Get single variant
exports.getSingleVariant = async (req, res) => {
  try {
    const { variantId } = req.params;
    if (!mongoose.Types.ObjectId.isValid(variantId)) {
      return res.status(400).json({ success: false, msg: "Invalid variant ID" });
    }

    const variant = await Variant.findById(variantId)
      .populate('product', 'name thumbnail')
      .populate('unit');

    if (!variant) return res.status(404).json({ success: false, msg: "Variant not found" });

    res.json({
      success: true,
      data: {
        variantId: variant._id,
        productName: variant.product?.name || "Unknown",
        sku: variant.sku,
        currentStock: variant.stockQuantity,
        expiryDate: variant.expiryDate,
        thumbnail: variant.image || variant.product?.thumbnail || "/placeholder.jpg",
        unit: variant.unit
      }
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, msg: "Server error" });
  }
};

// Stock movement history
exports.getStockMovements = async (req, res) => {
  try {
    const { variantId } = req.params;
    const { page = 1, limit = 20 } = req.query;

    if (!mongoose.Types.ObjectId.isValid(variantId)) {
      return res.status(400).json({ success: false, msg: "Invalid variant ID" });
    }

    const movements = await StockMovement.find({ variant: variantId })
      .populate('performedBy', 'name email')
      .sort({ createdAt: -1 })
      .skip((page - 1) * limit)
      .limit(parseInt(limit));

    const total = await StockMovement.countDocuments({ variant: variantId });

    res.json({
      success: true,
      data: movements.map(m => ({
        id: m._id,
        sku: m.sku,
        previousQuantity: m.previousQuantity,
        newQuantity: m.newQuantity,
        change: m.changeQuantity,
        movementType: m.movementType,
        reason: m.reason,
        referenceId: m.referenceId,
        performedBy: m.performedBy?.name || "System",
        date: m.createdAt
      })),
      pagination: { total, page: +page, pages: Math.ceil(total / limit), limit: +limit }
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, msg: "Failed to load history" });
  }
};