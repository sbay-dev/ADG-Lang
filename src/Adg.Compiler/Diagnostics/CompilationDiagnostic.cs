namespace Adg.Compiler;

internal sealed record CompilationDiagnostic(DiagnosticCode Code, string Message, string Severity = "Error")
{
    public override string ToString() => DiagnosticFormatter.Format(Code, Message);
}

internal abstract class AdgDiagnosticException : Exception
{
    protected AdgDiagnosticException(string message)
        : this(DiagnosticCode.Unknown, message)
    {
    }

    protected AdgDiagnosticException(DiagnosticCode code, string message)
        : base(DiagnosticFormatter.Format(code, message))
    {
        Code = code;
        RawMessage = message;
    }

    public DiagnosticCode Code { get; }

    public string RawMessage { get; }
}

internal sealed class AdgTypeException : AdgDiagnosticException
{
    public AdgTypeException(string message)
        : base(message)
    {
    }

    public AdgTypeException(DiagnosticCode code, string message)
        : base(code, message)
    {
    }
}

internal sealed class AdgParseException(string message) : AdgDiagnosticException(message);

internal sealed class CliException(string message) : Exception(message);

