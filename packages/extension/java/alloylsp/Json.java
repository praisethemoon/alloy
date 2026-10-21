package alloylsp;

import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

/** Just enough JSON for the session's line protocol, so the helper needs nothing but the Alloy jar. */
final class Json {

    private final String text;
    private int at;

    private Json(String text) {
        this.text = text;
    }

    @SuppressWarnings("unchecked")
    static Map<String, Object> parseObject(String text) {
        Json json = new Json(text);
        Object value = json.value();
        json.space();
        if (!(value instanceof Map) || json.at != text.length()) throw new IllegalArgumentException("A request must be one JSON object.");
        return (Map<String, Object>) value;
    }

    static String write(Object value) {
        StringBuilder out = new StringBuilder();
        write(value, out);
        return out.toString();
    }

    private static void write(Object value, StringBuilder out) {
        if (value == null) {
            out.append("null");
        } else if (value instanceof String) {
            quote((String) value, out);
        } else if (value instanceof Number || value instanceof Boolean) {
            out.append(value);
        } else if (value instanceof Map) {
            out.append('{');
            boolean first = true;
            for (Map.Entry<?, ?> entry : ((Map<?, ?>) value).entrySet()) {
                if (!first) out.append(',');
                first = false;
                quote(String.valueOf(entry.getKey()), out);
                out.append(':');
                write(entry.getValue(), out);
            }
            out.append('}');
        } else if (value instanceof Iterable) {
            out.append('[');
            boolean first = true;
            for (Object item : (Iterable<?>) value) {
                if (!first) out.append(',');
                first = false;
                write(item, out);
            }
            out.append(']');
        } else {
            quote(value.toString(), out);
        }
    }

    private static void quote(String s, StringBuilder out) {
        out.append('"');
        for (int i = 0; i < s.length(); i++) {
            char c = s.charAt(i);
            switch (c) {
                case '"': out.append("\\\""); break;
                case '\\': out.append("\\\\"); break;
                case '\n': out.append("\\n"); break;
                case '\r': out.append("\\r"); break;
                case '\t': out.append("\\t"); break;
                default:
                    if (c < 0x20) out.append(String.format("\\u%04x", (int) c));
                    else out.append(c);
            }
        }
        out.append('"');
    }

    private Object value() {
        space();
        if (at >= text.length()) throw error("a value");
        char c = text.charAt(at);
        if (c == '{') return object();
        if (c == '[') return array();
        if (c == '"') return string();
        if (text.startsWith("true", at)) { at += 4; return Boolean.TRUE; }
        if (text.startsWith("false", at)) { at += 5; return Boolean.FALSE; }
        if (text.startsWith("null", at)) { at += 4; return null; }
        return number();
    }

    private Map<String, Object> object() {
        Map<String, Object> map = new LinkedHashMap<>();
        at++;
        space();
        if (peek('}')) { at++; return map; }
        while (true) {
            space();
            String key = string();
            space();
            expect(':');
            map.put(key, value());
            space();
            if (peek(',')) { at++; continue; }
            expect('}');
            return map;
        }
    }

    private List<Object> array() {
        List<Object> list = new ArrayList<>();
        at++;
        space();
        if (peek(']')) { at++; return list; }
        while (true) {
            list.add(value());
            space();
            if (peek(',')) { at++; continue; }
            expect(']');
            return list;
        }
    }

    private String string() {
        expect('"');
        StringBuilder out = new StringBuilder();
        while (at < text.length()) {
            char c = text.charAt(at++);
            if (c == '"') return out.toString();
            if (c != '\\') { out.append(c); continue; }
            if (at >= text.length()) break;
            char e = text.charAt(at++);
            switch (e) {
                case 'n': out.append('\n'); break;
                case 'r': out.append('\r'); break;
                case 't': out.append('\t'); break;
                case 'b': out.append('\b'); break;
                case 'f': out.append('\f'); break;
                case 'u':
                    if (at + 4 > text.length()) throw error("four hex digits");
                    out.append((char) Integer.parseInt(text.substring(at, at + 4), 16));
                    at += 4;
                    break;
                default: out.append(e);
            }
        }
        throw error("a closing quote");
    }

    private Number number() {
        int start = at;
        while (at < text.length() && "+-0123456789.eE".indexOf(text.charAt(at)) >= 0) at++;
        if (start == at) throw error("a value");
        String n = text.substring(start, at);
        return n.contains(".") || n.contains("e") || n.contains("E") ? (Number) Double.parseDouble(n) : (Number) Long.parseLong(n);
    }

    private void space() {
        while (at < text.length() && Character.isWhitespace(text.charAt(at))) at++;
    }

    private boolean peek(char c) {
        return at < text.length() && text.charAt(at) == c;
    }

    private void expect(char c) {
        if (!peek(c)) throw error("'" + c + "'");
        at++;
    }

    private IllegalArgumentException error(String expected) {
        return new IllegalArgumentException("Bad JSON at " + at + ": expected " + expected + ".");
    }
}
