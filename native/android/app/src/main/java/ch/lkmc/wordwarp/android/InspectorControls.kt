package ch.lkmc.wordwarp.android

import androidx.compose.foundation.Canvas
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.gestures.detectDragGestures
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.KeyboardActions
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.focus.onFocusChanged
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.Path
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.platform.LocalFocusManager
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import org.json.JSONArray
import kotlin.math.round
import kotlin.math.roundToInt

@Composable
internal fun InspectorSectionContent(
    section: InspectorSection,
    onChange: (String, Any) -> Unit,
    onAction: (String) -> Unit,
    modifier: Modifier = Modifier,
    showTitle: Boolean = true,
) {
    Column(modifier, verticalArrangement = Arrangement.spacedBy(16.dp)) {
        if (showTitle) Text(section.label, style = MaterialTheme.typography.titleMedium, fontWeight = FontWeight.SemiBold)
        section.fields.forEach { field -> key(field.id) { InspectorFieldControl(field) { onChange(field.id, it) } } }
        section.children.forEach { child ->
            key(child.id) {
                var open by remember(child.id) { mutableStateOf(false) }
                OutlinedCard(Modifier.fillMaxWidth()) {
                    Row(Modifier.fillMaxWidth().clickable { open = !open }.padding(14.dp), verticalAlignment = Alignment.CenterVertically) {
                        Text(child.label, Modifier.weight(1f), style = MaterialTheme.typography.titleSmall)
                        Text(if (open) "−" else "+", style = MaterialTheme.typography.titleLarge)
                    }
                    if (open) InspectorSectionContent(child, onChange, onAction, Modifier.padding(14.dp), showTitle = false)
                }
            }
        }
        section.actions.forEach { action ->
            OutlinedButton(onClick = { onAction(action.id) }, modifier = Modifier.fillMaxWidth().testTag("action-${action.id}")) {
                Text(action.label)
            }
        }
    }
}

@Composable
internal fun InspectorFieldControl(field: InspectorField, onChange: (Any) -> Unit) {
    val modifier = Modifier.fillMaxWidth().testTag("field-${field.id}")
    when (field.type) {
        "text" -> OutlinedTextField(
            value = field.value?.toString().orEmpty(), onValueChange = { if (it.length <= (field.maxLength ?: 5000)) onChange(it) },
            label = { Text(field.label) }, singleLine = !field.multiline,
            minLines = if (field.multiline) 2 else 1, maxLines = if (field.multiline) 5 else 1,
            modifier = modifier, shape = RoundedCornerShape(12.dp),
        )
        "boolean" -> Row(modifier, verticalAlignment = Alignment.CenterVertically) {
            Text(field.label, Modifier.weight(1f), style = MaterialTheme.typography.bodyMedium)
            Switch(checked = field.value == true, onCheckedChange = { onChange(it) })
        }
        "number" -> NumericField(field, modifier, onChange)
        "choice" -> NativeChoiceField(field.label, field.value, field.options, modifier, onChange)
        "color" -> ColorField(field, modifier, onChange)
        "curve" -> CurveField(field, modifier, onChange)
    }
}

@Composable
private fun NumericField(field: InspectorField, modifier: Modifier, onChange: (Any) -> Unit) {
    val value = (field.value as? Number)?.toDouble() ?: 0.0
    val displayed = formatNumber(value)
    var draft by remember(field.id, displayed) { mutableStateOf(displayed) }
    var focused by remember { mutableStateOf(false) }
    val focus = LocalFocusManager.current
    fun commit() {
        val number = draft.toDoubleOrNull()
        if (number != null && number.isFinite()) {
            val clamped = (if (field.integer) round(number) else number).coerceIn(field.min ?: -Double.MAX_VALUE, field.max ?: Double.MAX_VALUE)
            if (clamped != value) onChange(clamped)
            draft = formatNumber(clamped)
        } else draft = displayed
    }
    Column(modifier, verticalArrangement = Arrangement.spacedBy(2.dp)) {
        OutlinedTextField(value = draft, onValueChange = { draft = it }, label = { Text(field.label) },
            singleLine = true, modifier = Modifier.fillMaxWidth().testTag("input-${field.id}").onFocusChanged {
                if (focused && !it.isFocused) commit()
                focused = it.isFocused
            }, shape = RoundedCornerShape(12.dp),
            keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Decimal, imeAction = ImeAction.Done),
            keyboardActions = KeyboardActions(onDone = { commit(); focus.clearFocus() }),
            trailingIcon = if ((field.min ?: 0.0) < 0) ({ TextButton(onClick = {
                draft = if (draft.startsWith('-')) draft.removePrefix("-") else "-$draft"
                commit()
            }) { Text("±") } }) else null,
        )
        if (field.min != null && field.max != null && field.max > field.min) {
            var dragging by remember(field.id) { mutableStateOf(false) }
            var sliderValue by remember(field.id) { mutableFloatStateOf(value.toFloat()) }
            LaunchedEffect(value) { if (!dragging) sliderValue = value.toFloat() }
            Slider(value = sliderValue.coerceIn(field.min.toFloat(), field.max.toFloat()),
                valueRange = field.min.toFloat()..field.max.toFloat(),
                onValueChange = {
                    dragging = true
                    sliderValue = it
                    val step = field.step ?: 0.01
                    val next = (round(it.toDouble() / step) * step).coerceIn(field.min, field.max)
                    draft = formatNumber(next)
                    onChange(next)
                }, onValueChangeFinished = { dragging = false }, modifier = Modifier.fillMaxWidth())
        }
    }
}

@Composable
internal fun NativeChoiceField(label: String, value: Any?, options: List<InspectorOption>, modifier: Modifier = Modifier, onChange: (Any) -> Unit) {
    var choosing by remember { mutableStateOf(false) }
    val selected = options.firstOrNull { it.value.toString() == value.toString() }
    OutlinedCard(onClick = { choosing = true }, modifier = modifier) {
        Row(Modifier.padding(14.dp), verticalAlignment = Alignment.CenterVertically) {
            Column(Modifier.weight(1f)) {
                Text(label, style = MaterialTheme.typography.labelMedium, color = MaterialTheme.colorScheme.onSurfaceVariant)
                Text(selected?.label ?: value?.toString().orEmpty(), style = MaterialTheme.typography.bodyLarge,
                    maxLines = 2, overflow = TextOverflow.Ellipsis)
            }
            Text("⌄", Modifier.padding(start = 8.dp), style = MaterialTheme.typography.titleLarge)
        }
    }
    if (choosing) {
        var search by remember { mutableStateOf("") }
        AlertDialog(onDismissRequest = { choosing = false }, title = { Text(label) },
            text = {
                Column(Modifier.heightIn(max = 420.dp), verticalArrangement = Arrangement.spacedBy(10.dp)) {
                    if (options.size > 8) OutlinedTextField(search, { search = it }, label = { Text("Search") }, singleLine = true,
                        modifier = Modifier.fillMaxWidth())
                    LazyColumn {
                        items(options.filter { it.label.contains(search, ignoreCase = true) }, key = { it.value.toString() }) { option ->
                            ListItem(headlineContent = { Text(option.label) },
                                leadingContent = { RadioButton(selected = option.value.toString() == value.toString(), onClick = null) },
                                modifier = Modifier.clickable { onChange(option.value); choosing = false })
                        }
                    }
                }
            }, confirmButton = { TextButton(onClick = { choosing = false }) { Text("Done") } })
    }
}

private fun rgbaColor(values: List<Double>): Color = Color(
    (values.getOrNull(0) ?: 0.0).toFloat().coerceIn(0f, 1f),
    (values.getOrNull(1) ?: 0.0).toFloat().coerceIn(0f, 1f),
    (values.getOrNull(2) ?: 0.0).toFloat().coerceIn(0f, 1f),
    (values.getOrNull(3) ?: 1.0).toFloat().coerceIn(0f, 1f))

@Composable
private fun ColorField(field: InspectorField, modifier: Modifier, onChange: (Any) -> Unit) {
    val components = field.value.numberValues()
    var picking by remember { mutableStateOf(false) }
    val color = rgbaColor(components)
    OutlinedCard(onClick = { picking = true }, modifier = modifier) {
        Row(Modifier.padding(12.dp), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(12.dp)) {
            Box(Modifier.size(36.dp).clip(CircleShape).background(color))
            Text(field.label, Modifier.weight(1f), style = MaterialTheme.typography.bodyMedium)
            Text("Edit", style = MaterialTheme.typography.labelLarge, color = MaterialTheme.colorScheme.primary)
        }
    }
    if (picking) {
        var channels by remember { mutableStateOf(listOf(color.red.toDouble(), color.green.toDouble(), color.blue.toDouble(), color.alpha.toDouble())) }
        var hex by remember { mutableStateOf(channels.take(3).joinToString("") { "%02X".format((it * 255).roundToInt()) }) }
        AlertDialog(onDismissRequest = { picking = false }, title = { Text(field.label) },
            text = {
                Column(Modifier.verticalScroll(rememberScrollState()), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                    Box(Modifier.fillMaxWidth().height(54.dp).clip(RoundedCornerShape(12.dp)).background(rgbaColor(channels)))
                    Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween) {
                        listOf(Color.White, Color.Black, Color(0xFFFF4C72), Color(0xFFFFBC42), Color(0xFF63D6C0), Color(0xFF6988FF)).forEach { preset ->
                            Box(Modifier.size(32.dp).clip(CircleShape).background(preset).clickable {
                                channels = listOf(preset.red.toDouble(), preset.green.toDouble(), preset.blue.toDouble(), channels[3])
                                hex = channels.take(3).joinToString("") { "%02X".format((it * 255).roundToInt()) }
                            })
                        }
                    }
                    OutlinedTextField(hex, { input ->
                        hex = input.removePrefix("#").take(6)
                        if (hex.matches(Regex("[0-9a-fA-F]{6}"))) {
                            channels = listOf(hex.substring(0, 2).toInt(16) / 255.0, hex.substring(2, 4).toInt(16) / 255.0,
                                hex.substring(4, 6).toInt(16) / 255.0, channels[3])
                        }
                    }, label = { Text("Hex color") }, prefix = { Text("#") }, singleLine = true, modifier = Modifier.testTag("color-hex"))
                    listOf("Red", "Green", "Blue", "Opacity").forEachIndexed { index, label ->
                        Text("$label  ${(channels[index] * 100).roundToInt()}%", style = MaterialTheme.typography.labelMedium)
                        Slider(value = channels[index].toFloat(), onValueChange = { next ->
                            channels = channels.toMutableList().also { it[index] = next.toDouble() }
                            hex = channels.take(3).joinToString("") { "%02X".format((it * 255).roundToInt()) }
                        })
                    }
                }
            }, confirmButton = { TextButton(onClick = { onChange(JSONArray(channels)); picking = false }) { Text("Apply") } },
            dismissButton = { TextButton(onClick = { picking = false }) { Text("Cancel") } })
    }
}

@Composable
private fun CurveField(field: InspectorField, modifier: Modifier, onChange: (Any) -> Unit) {
    val source = field.value.numberValues().ifEmpty { listOf(0.0, 0.25, 0.5, 0.75, 1.0) }
    var samples by remember(field.id, source) { mutableStateOf(source) }
    var selected by remember(field.id) { mutableIntStateOf(0) }
    val line = MaterialTheme.colorScheme.primary
    val grid = MaterialTheme.colorScheme.outlineVariant
    Column(modifier, verticalArrangement = Arrangement.spacedBy(8.dp)) {
        Text(field.label, style = MaterialTheme.typography.labelLarge)
        Canvas(Modifier.fillMaxWidth().height(110.dp).background(MaterialTheme.colorScheme.surfaceContainerHigh, RoundedCornerShape(12.dp))
            .pointerInput(field.id) {
                detectDragGestures(onDragEnd = { onChange(JSONArray(samples)) }) { change, _ ->
                    change.consume()
                    val index = ((change.position.x / size.width) * (samples.size - 1)).roundToInt().coerceIn(0, samples.lastIndex)
                    selected = index
                    samples = samples.toMutableList().also { it[index] = (1.0 - change.position.y / size.height).coerceIn(0.0, 1.0) }
                }
            }) {
            for (index in 1..3) {
                drawLine(grid, Offset(size.width * index / 4, 0f), Offset(size.width * index / 4, size.height))
                drawLine(grid, Offset(0f, size.height * index / 4), Offset(size.width, size.height * index / 4))
            }
            val path = Path()
            samples.forEachIndexed { index, sample ->
                val point = Offset(size.width * index / (samples.size - 1).coerceAtLeast(1), size.height * (1f - sample.toFloat()))
                if (index == 0) path.moveTo(point.x, point.y) else path.lineTo(point.x, point.y)
                drawCircle(line, 3.dp.toPx(), point)
            }
            drawPath(path, line, style = Stroke(2.dp.toPx()))
        }
        Row(verticalAlignment = Alignment.CenterVertically) {
            TextButton(onClick = { selected = (selected - 1).coerceAtLeast(0) }) { Text("‹") }
            Text("Point ${selected + 1} / ${samples.size}", Modifier.weight(1f), style = MaterialTheme.typography.labelMedium)
            TextButton(onClick = { selected = (selected + 1).coerceAtMost(samples.lastIndex) }) { Text("›") }
        }
        Slider(value = samples[selected.coerceAtMost(samples.lastIndex)].toFloat(), onValueChange = { next ->
            samples = samples.toMutableList().also { it[selected] = next.toDouble() }
            onChange(JSONArray(samples))
        })
    }
}

internal fun formatNumber(value: Double): String = if (value == value.toLong().toDouble()) value.toLong().toString()
    else "%.3f".format(java.util.Locale.ROOT, value).trimEnd('0').trimEnd('.')
