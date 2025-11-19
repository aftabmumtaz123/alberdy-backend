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
  try {
    session.startTransaction();

    const {
      variantId: bodyVariantId,
      quantityChange,
      isStockIncreasing,
      movementType = "Manual Adjustment",
      reason,
      referenceId,
      expiryAlertDate
    } = req.body;

    const variantId = variantIdFromParam || bodyVariantId;

    // Validation
    if (!variantId || !mongoose.Types.ObjectId.isValid(variantId)) {
      return res.status(400).json({ success: false, msg: "Valid variantId required" });
    }
    if (quantityChange == null || isStockIncreasing == null || !reason?.trim()) {
      return res.status(400).json({ success: false, msg: "Missing required fields" });
    }

    const qty = Math.abs(Number(quantityChange));
    if (isNaN(qty) || qty === 0) {
      return res.status(400).json({ success: false, msg: "Invalid quantity" });
    }

    const changeAmount = isStockIncreasing ? qty : -qty;

    const variant = await Variant.findById(variantId)
      .populate('product', 'name')
      .session(session);

    if (!variant) {
      await session.abortTransaction();
      return res.status(404).json({ success: false, msg: "Variant not found" });
    }

    if (variant.stockQuantity + changeAmount < 0) {
      await session.abortTransaction();
      return res.status(400).json({ success: false, msg: "Insufficient stock" });
    }

    const previousQty = variant.stockQuantity;
    variant.stockQuantity += changeAmount;

    if (expiryAlertDate) {
      const exp = new Date(expiryAlertDate);
      if (!isNaN(exp)) variant.expiryDate = exp;
    }

    await variant.save({ session });

    // THIS LINE IS CRITICAL – DO NOT SKIP!
    const movement = await StockMovement.create([{
      variant: variant._id,
      sku: variant.sku,
      previousQuantity: previousQty,
      newQuantity: variant.stockQuantity,
      changeQuantity: changeAmount,
      isStockIncreasing: isStockIncreasing === true,
      movementType: movementType.trim(),
      reason: reason.trim(),
      referenceId: referenceId?.trim() || generateReferenceId(),
      performedBy: await getPerformedBy(req),
    }], { session });  // ← MUST include session!

    // COMMIT ONLY AFTER BOTH SAVE
    await session.commitTransaction();

    res.json({
      success: true,
      msg: isStockIncreasing ? "Stock increased" : "Stock decreased",
      data: {
        variantId: variant._id,
        productName: variant.product.name,
        sku: variant.sku,
        previousQuantity: previousQty,
        newQuantity: variant.stockQuantity,
        change: changeAmount,
        movementType: movementType.trim(),
        referenceId: movement[0].referenceId,
        isStockIncreasing: isStockIncreasing === true,
        performedBy: req.user?.name || "System",
        performedAt: new Date().toISOString(),
        reason: reason.trim()
      }
    });

  } catch (err) {
    await session.abortTransaction();
    console.error("Stock Adjustment FAILED:", err);
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
    const { search = "", sort = "name", page = 1, limit = 200 } = req.query;
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
          createdAt: 1
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




// Get single variant → returns basic info + LATEST STOCK MOVEMENT
exports.getSingleVariant = async (req, res) => {
  try {
    let id = req.params.variantId || req.params.id;

    if (!id || !mongoose.Types.ObjectId.isValid(id.toString().trim())) {
      return res.status(400).json({ 
        success: false, 
        msg: "Valid variantId is required" 
      });
    }

    id = id.toString().trim();

    // 1. Get basic variant info (lean for speed)
    const variant = await Variant.findById(id)
      .select('sku stockQuantity image product')
      .populate('product', 'name thumbnail')
      .lean();

    if (!variant) {
      return res.status(404).json({ success: false, msg: "Variant not found" });
    }

    // 2. Get the LATEST stock movement
    const latestMovement = await StockMovement.findOne({ variant: id })
      .populate('performedBy', 'name')
      .sort({ createdAt: -1 })
      .lean();

    res.json({
      success: true,
      msg: latestMovement ? "Latest stock movement fetched" : "Variant found (no movements yet)",
      data: {
        variantId: variant._id.toString(),
        productName: variant.product?.name || "Unknown Product",
        sku: variant.sku || "N/A",
        currentStock: variant.stockQuantity,
        thumbnail: variant.image || variant.product?.thumbnail || "/placeholder.jpg",

        // ONLY the movement — clean and clear
        movement: latestMovement ? {
          previousQuantity: latestMovement.previousQuantity,
          newQuantity: latestMovement.newQuantity,
          changeQuantity: latestMovement.changeQuantity,
          isStockIncreasing: latestMovement.isStockIncreasing,
          movementType: latestMovement.movementType,
          reason: latestMovement.reason,
          referenceId: latestMovement.referenceId || null,
          performedBy: latestMovement.performedBy?.name || "System",
          performedAt: latestMovement.createdAt,
          createdAt: latestMovement.createdAt
        } : null
      }
    });

  } catch (err) {
    console.error("getSingleVariant Error:", err);
    res.status(500).json({ 
      success: false, 
      msg: "Server error", 
      error: err.message 
    });
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