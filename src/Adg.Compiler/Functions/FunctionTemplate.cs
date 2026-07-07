using System.Text;

namespace Adg.Compiler;

internal sealed record TemplateSegment(bool IsPlaceholder, string Text);

internal static class FunctionTemplate
{
    public static IReadOnlyList<TemplateSegment> Parse(string template)
    {
        var segments = new List<TemplateSegment>();
        var literal = new StringBuilder();
        var index = 0;

        while (index < template.Length)
        {
            var current = template[index];
            if (current == '{')
            {
                var close = template.IndexOf('}', index + 1);
                if (close < 0)
                {
                    throw new AdgParseException($"Unterminated placeholder in template: {template}");
                }

                if (literal.Length > 0)
                {
                    segments.Add(new TemplateSegment(false, literal.ToString()));
                    literal.Clear();
                }

                var name = template[(index + 1)..close].Trim();
                if (name.Length == 0)
                {
                    throw new AdgParseException($"Empty placeholder in template: {template}");
                }

                segments.Add(new TemplateSegment(true, name));
                index = close + 1;
                continue;
            }

            literal.Append(current);
            index++;
        }

        if (literal.Length > 0)
        {
            segments.Add(new TemplateSegment(false, literal.ToString()));
        }

        return segments;
    }

    public static IEnumerable<string> Placeholders(string template)
    {
        foreach (var segment in Parse(template))
        {
            if (segment.IsPlaceholder)
            {
                yield return segment.Text;
            }
        }
    }
}

