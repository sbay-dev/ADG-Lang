namespace Adg.Compiler;

internal sealed class AdgProgram(IAdgNode root)
{
    public IAdgNode Root { get; } = root;

    public string RenderText() => string.Join(' ', Root.RenderWords().Select(word => word.Surface));
}

