package app.wordwarp.android

import org.json.JSONArray
import org.json.JSONObject

internal data class InspectorOption(val value: Any, val label: String)
internal data class InspectorField(
    val id: String,
    val label: String,
    val type: String,
    val value: Any?,
    val min: Double? = null,
    val max: Double? = null,
    val step: Double? = null,
    val options: List<InspectorOption> = emptyList(),
    val multiline: Boolean = false,
    val integer: Boolean = false,
    val maxLength: Int? = null,
)
internal data class InspectorAction(val id: String, val label: String)
internal data class InspectorSection(
    val id: String,
    val label: String,
    val fields: List<InspectorField>,
    val category: String = "",
    val children: List<InspectorSection> = emptyList(),
    val actions: List<InspectorAction> = emptyList(),
)

internal fun JSONObject.inspectorSection(): InspectorSection = InspectorSection(
    id = getString("id"), label = getString("label"), category = optString("category"),
    fields = optJSONArray("fields").objects().map { field ->
        InspectorField(field.getString("id"), field.getString("label"), field.getString("type"),
            field.opt("value").takeUnless { it == JSONObject.NULL },
            field.optionalDouble("min"), field.optionalDouble("max"), field.optionalDouble("step"),
            field.optJSONArray("options").objects().map { InspectorOption(it.get("value"), it.getString("label")) },
            field.optBoolean("multiline"), field.optBoolean("integer"), if (field.has("maxLength")) field.getInt("maxLength") else null)
    },
    children = optJSONArray("children").objects().map { it.inspectorSection() },
    actions = optJSONArray("actions").objects().map { InspectorAction(it.getString("id"), it.getString("label")) },
)
internal fun JSONArray?.objects(): List<JSONObject> = if (this == null) emptyList() else
    (0 until length()).map { getJSONObject(it) }
internal fun JSONObject.optionalDouble(name: String): Double? = if (has(name) && !isNull(name)) getDouble(name) else null
internal fun Any?.numberValues(): List<Double> = when (this) {
    is JSONArray -> (0 until length()).map { optDouble(it, 0.0) }
    is List<*> -> map { (it as? Number)?.toDouble() ?: 0.0 }
    else -> emptyList()
}
