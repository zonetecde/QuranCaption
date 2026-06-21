from typing import Optional, Union

from transformers.models.wav2vec2_bert.modeling_wav2vec2_bert import (
    Wav2Vec2BertPreTrainedModel,
    Wav2Vec2BertModel,
    _HIDDEN_STATES_START_POSITION,
)
from transformers.utils import auto_docstring
from transformers.modeling_outputs import CausalLMOutput
import torch
from torch import nn

from .configuration_multi_level_ctc import Wav2Vec2BertForMultilevelCTCConfig


class Wav2Vec2BertForMultilevelCTC(Wav2Vec2BertPreTrainedModel):
    config_class = Wav2Vec2BertForMultilevelCTCConfig

    def __init__(self, config):
        super().__init__(config)

        self.wav2vec2_bert = Wav2Vec2BertModel(config)
        self.dropout = nn.Dropout(config.final_dropout)

        if config.level_to_vocab_size == {}:
            raise ValueError(
                f"You are trying to instantiate {self.__class__} with a configuration that "
                "does not define the vocabulary size of the language model head. Please "
                "instantiate the model as follows: `Wav2Vec2BertForCTC.from_pretrained(..., level_to_vocab_size=level_to_vocab_size)`. "
                "or define `level_to_vocab_size` of your model's configuration."
            )
        output_hidden_size = (
            config.output_hidden_size
            if hasattr(config, "add_adapter") and config.add_adapter
            else config.hidden_size
        )
        self.level_to_lm_head = nn.ModuleDict(
            {
                level: nn.Linear(output_hidden_size, vocab_size)
                for level, vocab_size in config.level_to_vocab_size.items()
            }
        )

        # Initialize weights and apply final processing
        self.post_init()

    @auto_docstring
    def forward(
        self,
        input_features: Optional[torch.Tensor],
        attention_mask: Optional[torch.Tensor] = None,
        output_attentions: Optional[bool] = None,
        output_hidden_states: Optional[bool] = None,
        return_dict: Optional[bool] = None,
        labels: Optional[dict[str, torch.Tensor]] = None,
    ) -> Union[tuple, CausalLMOutput]:
        r"""
        labels (dict[`str`, `torch.LongTensor`] level_name to its labels of shape `(batch_size, target_length)`, *optional*):
            Labels for connectionist temporal classification. Note that `target_length` has to be smaller or equal to
            the sequence length of the output logits. Indices are selected in `[-100, 0, ..., config.vocab_size - 1]`.
            All labels set to `-100` are ignored (masked), the loss is only computed for labels in `[0, ...,
            config.vocab_size - 1]`.
        """
        if labels is not None:
            if not isinstance(labels, dict):
                raise ValueError(
                    f"Label has to be a dict for level to its tartget labels got `{type(labels)}`"
                )
            for level in labels:
                if labels[level].max() >= self.config.level_to_vocab_size[level]:
                    raise ValueError(
                        f"Label values must be <= vocab_size: {self.config.level_to_vocab_size[level]} for level: `{level}`"
                    )

        return_dict = (
            return_dict if return_dict is not None else self.config.use_return_dict
        )

        outputs = self.wav2vec2_bert(
            input_features,
            attention_mask=attention_mask,
            output_attentions=output_attentions,
            output_hidden_states=output_hidden_states,
            return_dict=return_dict,
        )

        hidden_states = outputs[0]
        hidden_states = self.dropout(hidden_states)

        level_to_logits = {}
        for level in self.level_to_lm_head:
            level_to_logits[level] = self.level_to_lm_head[level](hidden_states)

        loss = None
        if labels is not None:
            # retrieve loss input_lengths from attention_mask
            attention_mask = (
                attention_mask
                if attention_mask is not None
                else torch.ones(
                    input_features.shape[:2],
                    device=input_features.device,
                    dtype=torch.long,
                )
            )
            input_lengths = self._get_feat_extract_output_lengths(
                attention_mask.sum([-1])
            ).to(torch.long)

            loss = 0.0
            for level in labels:
                # assuming that padded tokens are filled with -100
                # when not being attended to
                labels_mask = labels[level] >= 0
                target_lengths = labels_mask.sum(-1)
                flattened_targets = labels[level].masked_select(labels_mask)

                # ctc_loss doesn't support fp16
                log_probs = nn.functional.log_softmax(
                    level_to_logits[level], dim=-1, dtype=torch.float32
                ).transpose(0, 1)

                with torch.backends.cudnn.flags(enabled=False):
                    loss += self.config.level_to_loss_weight[
                        level
                    ] * nn.functional.ctc_loss(
                        log_probs,
                        flattened_targets,
                        input_lengths,
                        target_lengths,
                        blank=self.config.pad_token_id,
                        reduction=self.config.ctc_loss_reduction,
                        zero_infinity=self.config.ctc_zero_infinity,
                    )

        if not return_dict:
            output = (level_to_logits,) + outputs[_HIDDEN_STATES_START_POSITION:]
            return ((loss,) + output) if loss is not None else output

        return CausalLMOutput(
            loss=loss,
            logits=level_to_logits,
            hidden_states=outputs.hidden_states,
            attentions=outputs.attentions,
        )


__all__ = ["Wav2Vec2BertForMultilevelCTC"]
