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

// 1. Add / Update Stock (from modal)
exports.addInventory = async (req, res) => {
  try {
    const { variantId, quantityChange, reason, referenceId, expiryAlertDate } = req.body;

    if (!variantId || quantityChange === undefined || !reason?.trim()) {
      return res.status(400).json({ success: false, msg: "variantId, quantityChange and reason are required" });
    }

    const qty = Number(quantityChange);
    if (isNaN(qty) || qty === 0) return res.status(400).json({ success: false, msg: "Invalid quantity" });

    const variant = await Variant.findById(variantId).populate('product', 'name');
    if (!variant) return res.status(404).json({ success: false, msg: "Variant not found" });

    if (variant.stockQuantity + qty < 0) {
      return res.status(400).json({ success: false, msg: `Insufficient stock: ${variant.stockQuantity}` });
    }

    const previousQty = variant.stockQuantity;
    variant.stockQuantity += qty;

    if (expiryAlertDate) {
      const exp = new Date(expiryAlertDate);
      if (!isNaN(exp.getTime())) variant.expiryDate = exp;
    }

    await variant.save();

    await StockMovement.create({
      variant: variant._id,
      sku: variant.sku,
      previousQuantity: previousQty,
      newQuantity: variant.stockQuantity,
      changeQuantity: qty,
      movementType: qty > 0 ? 'Purchase/Received' : 'Damage',
      reason: reason.trim(),
      referenceId: referenceId?.trim() || null,
      performedBy: await getPerformedBy(req),
    });

    res.json({
      success: true,
      msg: qty > 0 ? "Stock added" : "Stock removed",
      data: {
        variantId: variant._id,
        productName: variant.product?.name || "Unknown",
        sku: variant.sku,
        previousQuantity: previousQty,
        newQuantity: variant.stockQuantity,
        change: qty,
        expiryDate: variant.expiryDate,
      },
    });
  } catch (err) {
    console.error("Add Inventory Error:", err);
    res.status(500).json({ success: false, msg: "Server error", error: err.message });
  }
};

// 2. Update Stock from Dashboard (via variantId in URL)
exports.updateInventory = async (req, res) => {
  try {
    const { variantId } = req.params;
    const { quantityChange, reason, referenceId, expiryAlertDate } = req.body;

    if (quantityChange === undefined || !reason?.trim()) {
      return res.status(400).json({ success: false, msg: "quantityChange and reason required" });
    }

    const qty = Number(quantityChange);
    if (isNaN(qty) || qty === 0) return res.status(400).json({ success: false, msg: "Invalid quantity" });

    const variant = await Variant.findById(variantId).populate('product', 'name');
    if (!variant) return res.status(404).json({ success: false, msg: "Variant not found" });

    if (variant.stockQuantity + qty < 0) {
      return res.status(400).json({ success: false, msg: `Insufficient stock: ${variant.stockQuantity}` });
    }

    const previousQty = variant.stockQuantity;
    variant.stockQuantity += qty;

    if (expiryAlertDate) {
      const exp = new Date(expiryAlertDate);
      if (!isNaN(exp.getTime())) variant.expiryDate = exp;
    }

    await variant.save();

    await StockMovement.create({
      variant: variant._id,
      sku: variant.sku,
      previousQuantity: previousQty,
      newQuantity: variant.stockQuantity,
      changeQuantity: qty,
      movementType: qty > 0 ? 'Purchase/Received' : 'Damage',
      reason: reason.trim(),
      referenceId: referenceId?.trim() || null,
      performedBy: await getPerformedBy(req),
    });

    res.json({
      success: true,
      msg: qty > 0 ? "Stock updated" : "Stock reduced",
      data: {
        variantId: variant._id,
        productName: variant.product?.name,
        sku: variant.sku,
        previousQuantity: previousQty,
        newQuantity: variant.stockQuantity,
        change: qty,
        expiryDate: variant.expiryDate,
      },
    });
  } catch (err) {
    console.error("Update Inventory Error:", err);
    res.status(500).json({ success: false, msg: "Server error", error: err.message });
  }
};

// 3. Get All Inventory (Dashboard) — Returns variantId as _id
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
      ],
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
          },
        },
      },

      { $sort: { ...(sort === "name" && { productName: 1 }), ...(sort === "stock" && { stockQuantity: 1 }), updatedAt: -1 } },
      { $skip: skip },
      { $limit: limitNum },

      {
        $project: {
          variantId: "$_id",           // ← THIS IS WHAT YOUR FRONTEND USES
          _id: 1,                      // still keep Mongo _id
          productName: 1,
          brandName: 1,
          categoryName: 1,
          thumbnail: 1,
          sku: 1,
          stockQuantity: 1,
          expiryDate: 1,
          statusLabel: 1,
          updatedAt: 1,
        },
      },
    ]);

    const total = await Variant.countDocuments({ isDeleted: { $ne: true }, status: { $ne: "Discontinued" }, ...searchFilter });

    res.json({
      success: true,
      data: variants,
      pagination: { total, page: pageNum, pages: Math.ceil(total / limitNum), limit: limitNum },
    });
  } catch (err) {
    console.error("Dashboard Error:", err);
    res.status(500).json({ success: false, msg: "Failed to load inventory", error: err.message });
  }
};

// 4. Get Single Variant (for modal pre-fill)
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
        productName: variant.product?.name,
        sku: variant.sku,
        currentStock: variant.stockQuantity,
        expiryDate: variant.expiryDate,
        thumbnail: variant.image || variant.product?.thumbnail,
        unit: variant.unit,
      },
    });
  } catch (err) {
    console.error("Get Single Variant Error:", err);
    res.status(500).json({ success: false, msg: "Server error", error: err.message });
  }
};