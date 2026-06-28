using System.Text.Json;

namespace Adg.Compiler;

internal static class JsonElementExtensions
{
    public static JsonElement GetRequiredProperty(this JsonElement element, params string[] names)
    {
        if (element.TryGetPropertyAny(out var property, names))
        {
            return property;
        }

        throw new AdgParseException($"Missing required property '{names[0]}'.");
    }

    public static bool TryGetPropertyAny(this JsonElement element, out JsonElement property, params string[] names)
    {
        if (element.ValueKind != JsonValueKind.Object)
        {
            throw new AdgParseException("Expected JSON object.");
        }

        foreach (var name in names)
        {
            if (element.TryGetProperty(name, out property))
            {
                return true;
            }
        }

        property = default;
        return false;
    }
}

