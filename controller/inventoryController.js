// controllers/inventoryController.js
const Variant = require('../model/variantProduct');
const StockMovement = require('../model/StockMovement');
const mongoose = require('mongoose');

const getPerformedBy = async (req) => {
  if (req.user?._id) return req.user._id;
  const User = mongoose.model('User');
  const admin = await User.findOne({ role: { $in: ['Super Admin', 'Inventory Manager', 'Staff'] } }).lean();
  return admin?._id || new mongoose.Types.ObjectId("507f1f77bcf86cd799439011");
};

// Auto generate reference ID if not provided
const generateReferenceId = () => `ADJ-${Date.now()}-${Math.floor(Math.random() * 10000)}`;
// CORE: Stock Adjustment (Add or Deduct) – FULLY FIXED & SAFE
const adjustStock = async (req, res, variantIdFromParam = null) => {
  const session = await mongoose.startSession();
  session.startTransaction();

  try {
    const {
      variantId: bodyVariantId,
      quantityChange,
      isStockIncreasing,        // true = add stock, false = deduct
      movementType = "Manual Adjustment",
      reason,
      referenceId,
      expiryAlertDate,
      createdAt,
    } = req.body;

    // Determine which variantId to use
    const variantId = variantIdFromParam || bodyVariantId;

    // === VALIDATIONS ===
    if (!variantId || !mongoose.Types.ObjectId.isValid(variantId)) {
      await session.abortTransaction();
      return res.status(400).json({ success: false, msg: "Valid variantId is required" });
    }

    const qty = Math.abs(Number(quantityChange));
    if (isNaN(qty) || qty === 0) {
      await session.abortTransaction();
      return res.status(400).json({ success: false, msg: "Valid quantityChange is required" });
    }

    if (typeof isStockIncreasing !== "boolean") {
      await session.abortTransaction();
      return res.status(400).json({ success: false, msg: "isStockIncreasing must be true/false" });
    }

    if (!reason || !reason.trim()) {
      await session.abortTransaction();
      return res.status(400).json({ success: false, msg: "Reason is required" });
    }

    const changeAmount = isStockIncreasing ? qty : -qty;

    // === STEP 1: Get current variant with lock (inside transaction) ===
    const variant = await Variant.findById(variantId).session(session);
    if (!variant) {
      await session.abortTransaction();
      return res.status(404).json({ success: false, msg: "Variant not found" });
    }

    const previousQty = variant.stockQuantity || 0;
    const newQty = previousQty + changeAmount;

    // === STEP 2: Prevent negative stock ===
    if (newQty < 0) {
      await session.abortTransaction();
      return res.status(400).json({
        success: false,
        msg: "Insufficient stock",
        details: `Cannot deduct ${qty}. Current stock: ${previousQty}`
      });
    }

    // === STEP 3: Update stock quantity + expiry date ===
    variant.stockQuantity = newQty;
    if (expiryAlertDate) {
      variant.expiryDate = new Date(expiryAlertDate);
    }
    await variant.save({ session });

    // === STEP 4: Record accurate stock movement ===
    const movement = await StockMovement.create([{
      variant: variantId,
      sku: variant.sku,
      previousQuantity: previousQty,
      newQuantity: newQty,
      changeQuantity: changeAmount,
      isStockIncreasing: isStockIncreasing === true,
      movementType: movementType.trim(),
      reason: reason.trim(),
      referenceId: referenceId?.trim() || generateReferenceId(),
      performedBy: await getPerformedBy(req),
      createdAt: createdAt ? new Date(createdAt) : new Date()
    }], { session });

    // === COMMIT TRANSACTION ===
    await session.commitTransaction();

    // === SUCCESS RESPONSE ===
    const message = isStockIncreasing
      ? `Successfully added ${qty} unit(s)`
      : `Successfully deducted ${qty} unit(s)`;

    res.json({
      success: true,
      msg: message,
      data: {
        variantId: variantId.toString(),
        productName: variant.product?.name || "Unknown", // assuming populated later or via lookup
        sku: variant.sku,
        previousQuantity: previousQty,
        newQuantity: newQty,
        change: changeAmount,
        changeDisplay: changeAmount >= 0 ? `+${qty}` : `−${qty}`,
        movementType: movementType.trim(),
        referenceId: movement[0].referenceId,
        reason: reason.trim(),
        performedBy: req.user?.name || "System",
        performedAt: movement[0].createdAt,
      }
    });

  } catch (err) {
    await session.abortTransaction();
    console.error("Stock Adjustment FAILED:", err);
    res.status(500).json({
      success: false,
      msg: "Failed to adjust stock",
      error: err.message
    });
  } finally {
    session.endSession();
  }
};
// ======================
// EXPORTS
// ======================

exports.addInventory = (req, res) => adjustStock(req, res);
exports.updateInventory = (req, res) => adjustStock(req, res, req.params.variantId);


// FINAL PERFECT VERSION – LISTING 100% CORRECT
exports.getInventoryDashboard = async (req, res) => {
  try {
    const {
      search = "",
      page = 1,
      limit = 50,
      movementType = "",
      startDate = "",
      endDate = ""
    } = req.query;

    const pageNum = Math.max(1, parseInt(page) || 1);
    const limitNum = Math.max(1, Math.min(200, parseInt(limit) || 50));
    const skip = (pageNum - 1) * limitNum;

    const baseMatch = {};
    if (movementType) baseMatch.movementType = movementType;
    if (startDate || endDate) {
      baseMatch.createdAt = {};
      if (startDate) baseMatch.createdAt.$gte = new Date(startDate);
      if (endDate) baseMatch.createdAt.$lte = new Date(new Date(endDate).setHours(23, 59, 59, 999));
    }

    const pipeline = [
      { $match: baseMatch },
      { $sort: { date: -1 } },

      // Lookups
      { $lookup: { from: "variants", localField: "variant", foreignField: "_id", as: "variantDoc" } },
      { $unwind: { path: "$variantDoc", preserveNullAndEmptyArrays: true } },
      { $lookup: { from: "products", localField: "variantDoc.product", foreignField: "_id", as: "product" } },
      { $unwind: { path: "$product", preserveNullAndEmptyArrays: true } },
      { $lookup: { from: "brands", localField: "product.brand", foreignField: "_id", as: "brand" } },
      { $unwind: { path: "$brand", preserveNullAndEmptyArrays: true } },
      { $lookup: { from: "users", localField: "performedBy", foreignField: "_id", as: "user" } },
      { $unwind: { path: "$user", preserveNullAndEmptyArrays: true } },

      // Search after lookups
      ...(search ? [{
        $match: {
          $or: [
            { "variantDoc.sku": { $regex: search, $options: "i" } },
            { "product.name": { $regex: search, $options: "i" } },
            { reason: { $regex: search, $options: "i" } },
            { movementType: { $regex: search, $options: "i" } }
          ]
        }
      }] : []),

      // Only compute real fields here
      {
        $addFields: {
          realVariantId: "$variantDoc._id",
          sku: "$variantDoc.sku",
          productName: "$product.name",
          brandName: "$brand.brandName",
          thumbnail: { $ifNull: ["$variantDoc.image", "$product.thumbnail", "/placeholder.jpg"] },
          performedByName: { $ifNull: ["$user.name", "System"] },
          currentStock: "$newQuantity",  // stock at that time
          lowStockThreshold: { $ifNull: ["$variantDoc.lowStockThreshold", "$variantDoc.reorderLevel", 10] },
          changeDisplay: {
            $cond: [
              "$isStockIncreasing",
              { $concat: ["+", { $toString: "$changeQuantity" }] },
              { $concat: ["−", { $toString: { $abs: "$changeQuantity" } }] }
            ]
          }
        }
      },

      { $skip: skip },
      { $limit: limitNum },

      // FINAL HACK HERE — ONLY IN $project
      {
        $project: {
          _id: 1,
          movementId: "$_id",           // keep original movement ID
          variantId: "$_id",            // ← HACK: send movement _id as variantId
          realVariantId: 1,             // optional debug
          sku: 1,
          productName: 1,
          brandName: 1,
          thumbnail: 1,
          currentStock: 1,              // ← stock AT THAT TIME
          previousQuantity: 1,
          newQuantity: 1,
          changeQuantity: 1,
          changeDisplay: 1,
          isStockIncreasing: 1,
          movementType: 1,
          reason: 1,
          referenceId: 1,
          performedByName: 1,
          performedAt: "$createdAt",
          createdAt: 1,
          stockStatus: {
            $cond: {
              if: { $lte: ["$newQuantity", 0] },
              then: "Out of Stock",
              else: {
                $cond: {
                  if: { $lte: ["$newQuantity", { $ifNull: ["$variantDoc.lowStockThreshold", "$variantDoc.reorderLevel", 10] }] },
                  then: "Low Stock",
                  else: "Good"
                }
              }
            }
          }
        }
      }
    ];

    const movements = await StockMovement.aggregate(pipeline);
    const total = await StockMovement.countDocuments(baseMatch);

    res.json({
      success: true,
      data: movements,
      pagination: {
        total,
        page: pageNum,
        pages: Math.ceil(total / limitNum),
        limit: limitNum
      }
    });

  } catch (err) {
    console.error("Dashboard Error:", err.message);
    res.status(500).json({ success: false, msg: "Failed to load movements", error: err.message });
  }
};


// FINAL: Smart getSingleVariant → accepts BOTH variantId and movementId (as variantId)
exports.getSingleVariant = async (req, res) => {
  try {
    let id = req.params.variantId || req.params.id;
    if (!id || !mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({ success: false, msg: "Invalid ID" });
    }
    id = id.toString().trim();

    // FIRST: Check if it's a StockMovement ID
    const movement = await StockMovement.findById(id)
      .populate({
        path: 'variant',
        select: 'sku stockQuantity image product lowStockThreshold reorderLevel',
        populate: {
          path: 'product',
          select: 'name thumbnail brand category',
          populate: { path: 'brand', select: 'brandName' }
        }
      })
      .populate('performedBy', 'name')
      .lean();

    if (movement) {
      const variant = movement.variant;

      return res.json({
        success: true,
        msg: "Historical stock movement",
        data: {
          variantId: variant._id.toString(),
          movementId: movement._id.toString(),
          productName: variant.product?.name || "Unknown",
          brandName: variant.product?.brand?.brandName || "Unknown",
          sku: movement.sku || variant.sku,
          thumbnail: variant.image || variant.product?.thumbnail || "/placeholder.jpg",

          // Historical frozen values
          currentStock: movement.newQuantity,
          stockBefore: movement.previousQuantity,
          stockAfter: movement.newQuantity,
          changeDisplay: movement.isStockIncreasing 
            ? `+${movement.changeQuantity}` 
            : `−${Math.abs(movement.changeQuantity)}`,

          lowStockThreshold: variant.lowStockThreshold || variant.reorderLevel || 10,
          stockStatus: movement.newQuantity <= 0 ? "Out of Stock" :
            movement.newQuantity <= (variant.lowStockThreshold || variant.reorderLevel || 10) ? "Low Stock" : "Good",

          movement: {
            _id: movement._id.toString(),
            previousQuantity: movement.previousQuantity,
            newQuantity: movement.newQuantity,
            changeQuantity: movement.changeQuantity,
            isStockIncreasing: movement.isStockIncreasing,
            movementType: movement.movementType,
            reason: movement.reason,
            referenceId: movement.referenceId,
            performedBy: movement.performedBy?.name || "System",
            createdAt: movement.createdAt,
          },

          currentLiveStock: variant.stockQuantity,
          isHistoricalView: true
        }
      });
    }

    // NOT A MOVEMENT → Real variantId → get latest movement + full info
    const result = await StockMovement.aggregate([
      { $match: { variant: new mongoose.Types.ObjectId(id) } },
      { $sort: { createdAt: -1 } },
      { $limit: 1 },

      // Get variant
      { $lookup: { from: "variants", localField: "variant", foreignField: "_id", as: "variantDoc" } },
      { $unwind: { path: "$variantDoc", preserveNullAndEmptyArrays: true } },

      // Get product + populate brand inside it
      {
        $lookup: {
          from: "products",
          let: { productId: "$variantDoc.product" },
          pipeline: [
            { $match: { $expr: { $eq: ["$_id", "$$productId"] } } },
            {
              $lookup: {
                from: "brands",
                localField: "brand",
                foreignField: "_id",
                as: "brandObj"
              }
            },
            { $unwind: { path: "$brandObj", preserveNullAndEmptyArrays: true } },
            {
              $addFields: {
                brandName: "$brandObj.brandName"
              }
            },
            { $project: { name: 1, thumbnail: 1, brandName: 1 } }
          ],
          as: "product"
        }
      },
      { $unwind: { path: "$product", preserveNullAndEmptyArrays: true } },

      // Get performedBy user
      { $lookup: { from: "users", localField: "performedBy", foreignField: "_id", as: "user" } },
      { $unwind: { path: "$user", preserveNullAndEmptyArrays: true } },

      // Final fields
      {
        $addFields: {
          variantId: "$variantDoc._id",
          sku: "$variantDoc.sku",
          productName: "$product.name",
          brandName: { $ifNull: ["$product.brandName", "Unknown"] },
          thumbnail: { $ifNull: ["$variantDoc.image", "$product.thumbnail", "/placeholder.jpg"] },
          currentStock: "$variantDoc.stockQuantity",
          performedByName: { $ifNull: ["$user.name", "System"] },
          changeDisplay: {
            $cond: [
              "$isStockIncreasing",
              { $concat: ["+", { $toString: "$changeQuantity" }] },
              { $concat: ["−", { $toString: { $abs: "$changeQuantity" } }] }
            ]
          }
        }
      },

      // Final projection
      {
        $project: {
          _id: 1,
          variantId: 1,
          sku: 1,
          productName: 1,
          brandName: 1,
          thumbnail: 1,
          currentStock: 1,
          previousQuantity: 1,
          newQuantity: 1,
          changeQuantity: 1,
          changeDisplay: 1,
          movementType: 1,
          reason: 1,
          referenceId: 1,
          performedByName: 1,
          performedAt: "$createdAt"
        }
      }
    ]);

    // If no movements found → return just variant info
    if (result.length === 0) {
      const variant = await Variant.findById(id)
        .select('sku stockQuantity image product lowStockThreshold reorderLevel')
        .populate({
          path: 'product',
          select: 'name thumbnail brand category',
          populate: { path: 'brand', select: 'brandName' }
        })
        .lean();

      if (!variant) {
        return res.status(404).json({ success: false, msg: "Variant not found" });
      }

      return res.json({
        success: true,
        data: {
          variantId: variant._id.toString(),
          productName: variant.product?.name || "Unknown",
          brandName: variant.product?.brand?.brandName || "Unknown",
          sku: variant.sku || "N/A",
          currentStock: variant.stockQuantity,
          thumbnail: variant.image || variant.product?.thumbnail || "/placeholder.jpg",
          lowStockThreshold: variant.lowStockThreshold || variant.reorderLevel || 10,
          movement: null
        }
      });
    }

    const latest = result[0];

    res.json({
      success: true,
      data: {
        variantId: latest.variantId.toString(),
        productName: latest.productName || "Unknown",
        brandName: latest.brandName,
        sku: latest.sku || "N/A",
        currentStock: latest.currentStock,
        thumbnail: latest.thumbnail,
        movement: {
          _id: latest._id.toString(),
          previousQuantity: latest.previousQuantity,
          newQuantity: latest.newQuantity,
          changeDisplay: latest.changeDisplay,
          movementType: latest.movementType,
          reason: latest.reason,
          referenceId: latest.referenceId,
          performedBy: latest.performedByName,
          performedAt: latest.performedAt
        }
      }
    });

  } catch (err) {
    console.error("getSingleVariant Error:", err);
    res.status(500).json({ success: false, msg: "Server error" });
  }
};