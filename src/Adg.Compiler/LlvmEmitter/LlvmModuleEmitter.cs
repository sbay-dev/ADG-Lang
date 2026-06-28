using System.Text;

namespace Adg.Compiler;

internal static class LlvmModuleEmitter
{
    public static string Emit(VerifiedAdgProgram program, string sourceName)
    {
        var outputBytes = Encoding.UTF8.GetBytes(program.RenderText());
        var length = outputBytes.Length + 1;

        return $$"""
        ; ADG-Lang native module generated from {{sourceName}}
        source_filename = "{{EscapeLlvmString(sourceName)}}"

        @adg_output = private unnamed_addr constant [{{length}} x i8] c"{{EscapeLlvmCString(outputBytes)}}\00", align 1

        declare i32 @puts(ptr)

        define i32 @main() {
        entry:
          %printed = call i32 @puts(ptr @adg_output)
          ret i32 0
        }
        """;
    }

    private static string EscapeLlvmCString(byte[] bytes)
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
                builder.Append(value.ToString("X2"));
            }
        }

        return builder.ToString();
    }

    private static string EscapeLlvmString(string value) => value.Replace("\\", "\\5C", StringComparison.Ordinal).Replace("\"", "\\22", StringComparison.Ordinal);
}

