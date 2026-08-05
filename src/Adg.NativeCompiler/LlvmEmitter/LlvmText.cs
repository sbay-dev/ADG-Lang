using System.Globalization;
using System.Text;

namespace Adg.NativeCompiler;

/// <summary>
/// Shared helpers for turning UTF-8 payloads into LLVM IR string literals.
/// Non-ASCII bytes are hex-escaped so symbol bodies stay valid on every target.
/// </summary>
internal static class LlvmText
{
    public static string EscapeCString(byte[] bytes)
    {
        var builder = new StringBuilder(bytes.Length * 4);
        foreach (var value in bytes)
        {
            if (value is >= 0x20 and <= 0x7e && value is not (byte)'\\' and not (byte)'"')
            {
                builder.Append((char)value);
            }
            else
            {
                builder.Append('\\');
                builder.Append(value.ToString("X2", CultureInfo.InvariantCulture));
            }
        }

        return builder.ToString();
    }

    public static string EscapePlain(string value) =>
        value.Replace("\\", "\\5C", StringComparison.Ordinal).Replace("\"", "\\22", StringComparison.Ordinal);
}
